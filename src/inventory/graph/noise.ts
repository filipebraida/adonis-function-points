import { Node } from 'ts-morph'
import type { CallExpression, ClassDeclaration } from 'ts-morph'

/**
 * Calls that cannot be a data access, and so must not count against coverage.
 *
 * Coverage is all-or-nothing per transaction — one unresolved call sinks the
 * whole thing — so reporting a `Map.get()` costs a transaction, not a line. On
 * a production application that dragged the metric from what the tracing
 * actually achieves down to 53%, and a gate that fails spuriously does not
 * protect: it teaches people to switch the gate off.
 *
 * The bar for silencing anything here is high, because a silent drop is the
 * worst defect this package can have. So the rule is to decide by what the
 * RECEIVER IS, resolved from the code, rather than by what the method is
 * called: `get`, `find` and `has` are Map methods and repository methods alike,
 * and a list of method names would hide real gaps to buy coverage.
 */

/** built-ins whose methods are never an application data access */
const NATIVE_TYPES = new Set([
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Array',
  'Date',
  'RegExp',
  'Promise',
  'Intl',
  'URL',
  'URLSearchParams',
])

/**
 * Methods that cannot be a data access whatever the receiver.
 *
 * Deliberately short, and deliberately excludes `get`, `set`, `has`, `find`,
 * `first`, `all`, `create`, `update`, `delete`, `save` and `count` — every one
 * of those is as plausible on a repository as on a collection.
 */
const NEVER_DATA_METHODS = new Set([
  // string and array
  'includes',
  'indexOf',
  'join',
  'split',
  'trim',
  'toLowerCase',
  'toUpperCase',
  'padStart',
  'padEnd',
  // luxon
  'toISO',
  'toISODate',
  // Date, whose `toISOString` sits beside luxon's `toISO`
  'toISOString',
  'toFormat',
  'toUTC',
  'toSQL',
  'toJSDate',
  'toRelative',
  // Lucid, present on every model and not an access
  'useTransaction',
  'serialize',
  'serializeAttributes',
  'toJSON',
  // VineJS
  'validate',
  // Promise: `validator.validate(p).catch(…)` reports the OUTER call, so the
  // method seen is `catch`, not `validate`
  'catch',
  'then',
  'finally',
  // BaseTransformer helpers, called from inside the `toObject` the tracer now
  // reaches: following transformers is what exposed them
  'pick',
  'whenLoaded',
  'whenNotNull',
  'primitive',
])

/**
 * Array iteration, which is noise ONLY when a callback is passed.
 *
 * This is the one place a method name is allowed to matter, and it is guarded:
 * `repo.find(id)` is a data access while `rows.find((r) => r.id === id)` is a
 * predicate over a list already in memory. The callback is what separates them,
 * so the list alone decides nothing — `some`, `every` and `find` stay safe.
 */
const ITERATION_METHODS = new Set([
  'map',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'some',
  'every',
  'forEach',
  'flatMap',
  'reduce',
  'sort',
])

/**
 * AdonisJS services, which reach the tracer through an application alias.
 *
 * `env` is imported from `#start/env`, an application module, so the symbol
 * resolves and then no body is found — the implementation lives in the
 * package. They are named by convention and unambiguous in an AdonisJS app.
 */
const FRAMEWORK_SERVICES = new Set([
  'env',
  'redis',
  'limiter',
  'logger',
  'health',
  'hash',
  'mail',
  'drive',
  'emitter',
  'router',
  'encryption',
  'i18n',
  'ally',
  'bouncer',
  // an ace command's terminal and application handle: `this.ui.table()`, `this.colors.red()`, `this.app.makePath()`
  'ui',
  'colors',
  'app',
])

/** Is this call one that cannot reach a data store? */
export function isNoise(call: CallExpression, owner?: ClassDeclaration): boolean {
  const expression = call.getExpression()
  if (!Node.isPropertyAccessExpression(expression)) return false

  if (NEVER_DATA_METHODS.has(expression.getName())) return true
  if (isIteration(expression.getName(), call)) return true

  const receiver = expression.getExpression()

  if (Node.isIdentifier(receiver) && FRAMEWORK_SERVICES.has(receiver.getText())) return true

  /**
   * `this.logger?.error(…)`: the same services also arrive as class properties,
   * injected or assigned, and then the receiver is a property access rather
   * than a bare identifier.
   */
  if (
    Node.isPropertyAccessExpression(receiver) &&
    Node.isThisExpression(receiver.getExpression()) &&
    FRAMEWORK_SERVICES.has(receiver.getName())
  ) {
    return true
  }

  return isNativeReceiver(receiver, owner)
}

/**
 * Iteration over a list, checked BEFORE the resolvers run.
 *
 * `PAPEIS_CONCEDIVEIS.map((name) => …)` is `Identifier.method(args)`, the shape
 * `static-service` exists for, so the resolver claimed it, resolved the enum
 * module, found no `map` in it and reported a gap — noise never got asked,
 * because it is only consulted once every resolver has declined.
 *
 * No resolver's pattern is `X.map(callback)`, so refusing this shape up front
 * costs nothing and is not the same as silencing an unresolved call: nothing
 * was ever there to resolve.
 */
export function isIterationCall(call: CallExpression): boolean {
  const expression = call.getExpression()
  if (!Node.isPropertyAccessExpression(expression)) return false

  return isIteration(expression.getName(), call)
}

/** An iteration method whose first argument is an inline callback. */
function isIteration(method: string, call: CallExpression): boolean {
  if (!ITERATION_METHODS.has(method)) return false

  const first = call.getArguments()[0]
  return first !== undefined && (Node.isArrowFunction(first) || Node.isFunctionExpression(first))
}

/** Does the receiver resolve to a built-in, by its declaration? */
function isNativeReceiver(receiver: Node, owner?: ClassDeclaration): boolean {
  // `['a', 'b'].includes(x)` / `'abc'.split(x)`
  if (Node.isArrayLiteralExpression(receiver) || Node.isStringLiteral(receiver)) return true

  // `this.names.get(id)` where `private names = new Map()`
  if (Node.isPropertyAccessExpression(receiver) && receiver.getExpression().getKind()) {
    const inner = receiver.getExpression()
    if (Node.isThisExpression(inner) && owner) {
      return isNativeProperty(owner, receiver.getName())
    }
  }

  return false
}

function isNativeProperty(owner: ClassDeclaration, name: string): boolean {
  /**
   * Both shapes declare a field: a class property, and a constructor parameter
   * property. Reading only the first missed every `Map` handed in through the
   * constructor, which is how a transformer usually receives its lookups.
   */
  const property =
    owner.getProperty(name) ??
    owner
      .getConstructors()[0]
      ?.getParameters()
      .find((parameter) => parameter.getName() === name)

  if (!property) return false

  const typeNode = property.getTypeNode()?.getText()
  if (typeNode && NATIVE_TYPES.has(typeNode.replace(/<.*/, '').trim())) return true

  const initializer = property.getInitializer()
  if (initializer && Node.isNewExpression(initializer)) {
    return NATIVE_TYPES.has(initializer.getExpression().getText())
  }

  return (
    initializer !== undefined &&
    (Node.isArrayLiteralExpression(initializer) || Node.isStringLiteral(initializer))
  )
}

/**
 * The body-not-found path: a symbol resolved to an application file whose
 * member is not there. For a framework service that is expected — the
 * implementation is in the package — and says nothing about tracing quality.
 */
export function isNoiseMember(file: string, member?: string): boolean {
  if (member && NEVER_DATA_METHODS.has(member)) return true

  const base = file
    .split('/')
    .pop()
    ?.replace(/\.[jt]s$/, '')

  return base !== undefined && FRAMEWORK_SERVICES.has(base)
}
