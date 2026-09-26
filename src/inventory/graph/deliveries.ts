import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression, Expression, Identifier, SourceFile, Type } from 'ts-morph'

import { detectAccess, rootSymbolOf } from '../detectors/lucid.js'
import type { RelationMap, StoreSymbols } from '../detectors/lucid.js'
import { mappedLiteralOf, unwrap } from './output_fields.js'
import type { HandlerRef } from '../../types.js'

/**
 * What a transaction DELIVERS — counting-decisions §6, plan 0.7 §A′.
 *
 * The DETs of an output are the fields that cross the boundary, and the place
 * they cross is the delivery: the props handed to `inertia.render` /
 * `inertia.modal` / `view.render`, the payload of `response.json|ok|created|send`,
 * a literal the handler returns. Before this, "what leaves" was every column of
 * every store the transaction touched — a `findOrFail` made to authorise handed
 * the whole table to the screen, and a derived `total` handed nothing.
 *
 * Measured on three applications first: no delivered collection is a variable
 * bound to a store; they come out of query objects the graph already follows.
 * So a delivered value that comes from a followed call is resolved to what that
 * body returns — the graph does that in `run()`, once the bodies are known; this
 * module only says WHAT was delivered and where it came from.
 */

export type Delivery =
  /** a variable bound to a store: its columns leave */
  | { kind: 'store'; store: string; path: string }
  /**
   * The result of a call a strategy followed: what that body returns leaves.
   * `args` are the call's arguments, classified — a body that returns no literal
   * and reads no store (a CSV builder) delivers what was handed INTO it.
   */
  | {
      kind: 'call'
      refs: HandlerRef[]
      path: string
      expression: string
      args: Delivery[]
      /**
       * One key of what the call returns — `const { data } = await q.handle()`,
       * `relatorio.linhas` — rather than the whole result. Resolved against the
       * body's classified return, keeping only that key.
       */
      pick?: string
    }
  /** a scalar, a property, an expression: one DET */
  | { kind: 'scalar'; path: string }
  /** an input echoed back — the validated payload, a field read off the request: counts once, on entry */
  | { kind: 'echo'; path: string }
  /** something the classifier cannot read: one DET as a floor, reported */
  | { kind: 'opaque'; path: string; expression: string }

/** `inertia.render(page, props)`, `inertia.modal(page, props)`, `view.render(view, props)` */
const RENDERERS = new Set(['inertia', 'view'])
const RENDER_METHODS = new Set(['render', 'modal'])
/** `response.json(x)`, `.ok(x)`, `.created(x)`, `.send(x)`, `.accepted(x)` */
const RESPONSE_METHODS = new Set(['json', 'ok', 'created', 'accepted', 'send'])
/**
 * An ace command prints: `this.ui.table().row([…])`, `this.logger.info(…)`,
 * `console.log(…)`. What a report hands to the terminal is what leaves — every
 * argument is delivered, read like a prop (plan 0.7 §C).
 */
const PRINTERS = new Set(['ui', 'logger', 'console'])
/** `x.data`, `x.rows` on a paginated / wrapped result hand the collection on */
const PASSES_THROUGH = new Set(['data', 'rows', 'all', 'toJSON', 'serialize'])
/** keys of a result that carry its rows: picking one of these is not picking one value */
export const PASSES_ROWS = new Set(['data', 'rows', 'items', 'results', 'list', 'linhas', 'itens'])
/** properties of a result that are one value, not its rows */
const SCALAR_PROPS = new Set(['length', 'size', 'total', 'count'])
/**
 * What Lucid's `paginator.getMeta()` says that a page can show. The URLs are
 * navigation and `firstPage` a constant: neither is a user-recognisable attribute.
 */
const PAGINATOR_META = ['total', 'perPage', 'currentPage', 'lastPage']
/** methods that return the same collection, or one of its rows: what leaves is the receiver */
const SAME_COLLECTION = new Set([
  'slice',
  'filter',
  'sort',
  'sortBy',
  'toSorted',
  'reverse',
  'toReversed',
  'concat',
  'flat',
  'find',
  'findLast',
  'at',
  'first',
  'last',
])
/** reads of the request whose result echoes input already counted on entry */
const ECHOES_INPUT = new Set(['validateUsing', 'input', 'only', 'all', 'body', 'qs', 'params'])
/** Inertia's lazy props: `inertia.defer(() => q.handle())` — the callback's value is what leaves */
const INERTIA_LAZY = new Set(['defer', 'lazy', 'optional', 'always', 'merge', 'scroll', 'once'])
/** a yes/no: an authorisation check, a membership test */
const BOOLEAN_METHODS = new Set([
  'allows',
  'denies',
  'can',
  'cannot',
  'includes',
  'has',
  'startsWith',
  'endsWith',
  'test',
])
/** a value formatted: still one value */
const FORMAT_METHODS = new Set([
  'join',
  'toString',
  'toISO',
  'toISODate',
  'toISOTime',
  'toISOString',
  'toFormat',
  'toRFC2822',
  'toHTTP',
  'toSQL',
  'toLocaleString',
  'toLocaleDateString',
  'toFixed',
  'toUnixInteger',
  'toMillis',
  'trim',
  'toUpperCase',
  'toLowerCase',
  'padStart',
  'padEnd',
  'replace',
  'slice',
  'substring',
])
/** framework services whose calls hand back one value: a translation, a session key, a URL */
const SCALAR_SERVICES = new Set([
  'i18n',
  'session',
  'env',
  'router',
  'encryption',
  'hash',
  'config',
  'app',
])
/** built-ins whose static calls are one value or a constant list: `Object.values(Enum)`, `JSON.stringify(x)` */
const NATIVE_GLOBALS = new Set([
  'Object',
  'Array',
  'JSON',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Date',
  'Intl',
])

export type DeliveryContext = {
  body: Node
  file: SourceFile
  symbols: StoreSymbols
  relations: RelationMap
  followed: Map<CallExpression, HandlerRef[]>
}

export type BodyDeliveries = {
  /** props handed to a renderer or a response method, anywhere in the body */
  calls: Delivery[]
  /** a delivery call was found, even with nothing readable in it */
  anyCall: boolean
  /**
   * What a `return` hands back that is not one of those calls — meaningful for
   * the ENTRY body only, where returning a value is delivering it; a followed
   * body's return is read by `returnedLeavesOf` instead.
   */
  returns: Delivery[]
  anyReturn: boolean
}

/**
 * The deliveries of a body: every props argument handed to a renderer or a
 * response method, and what a `return` hands back that is not one of those calls.
 */
export function deliveriesIn(ctx: DeliveryContext): BodyDeliveries {
  const deliveries: Delivery[] = []
  const returns: Delivery[] = []
  let any = false
  let anyReturn = false
  const seen = new Set<Node>()

  for (const call of ctx.body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression()
    if (!Node.isPropertyAccessExpression(callee)) continue
    const method = callee.getName()
    const receiver = lastSegmentOf(callee.getExpression())

    let payload: Node | undefined
    if (RENDERERS.has(receiver) && RENDER_METHODS.has(method)) payload = call.getArguments()[1]
    else if (receiver === 'response' && RESPONSE_METHODS.has(method))
      payload = call.getArguments()[0]
    else if (isPrinter(callee.getExpression(), ctx.body)) {
      any = true
      seen.add(call)
      for (const argument of call.getArguments()) classify(unwrap(argument), '', ctx, deliveries, 0)
      continue
    } else continue

    any = true
    if (!payload) continue
    seen.add(call)
    classify(unwrap(payload), '', ctx, deliveries, 0)
  }

  {
    for (const statement of ctx.body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      const enclosing = statement.getFirstAncestor(
        (node) =>
          Node.isArrowFunction(node) ||
          Node.isFunctionExpression(node) ||
          Node.isMethodDeclaration(node) ||
          Node.isFunctionDeclaration(node)
      )
      if (enclosing !== ctx.body) continue

      const value = unwrap(statement.getExpression())
      if (!value) continue
      if (Node.isCallExpression(value)) {
        if (seen.has(value)) continue
        /**
         * `return response.redirect().toRoute(…)`, `return response.noContent()`,
         * `return inertia.render(…)` (seen above): a call whose chain is rooted at
         * the response or a renderer is the response itself, not a value handed
         * back — nothing to classify.
         */
        const root = chainRootOf(value)
        if (root && (RENDERERS.has(root) || root === 'response')) continue
      }
      anyReturn = true
      classify(value, '', ctx, returns, 0)
    }
  }

  return { calls: deliveries, anyCall: any, returns, anyReturn }
}

/** the identifier a call chain is rooted at: `response.redirect().toRoute(x)` -> 'response' */
function chainRootOf(node: Node): string | null {
  let current: Node | undefined = node
  for (let depth = 0; current && depth < 40; depth++) {
    if (Node.isCallExpression(current) || Node.isPropertyAccessExpression(current)) {
      current = current.getExpression()
      continue
    }
    if (Node.isAwaitExpression(current) || Node.isParenthesizedExpression(current)) {
      current = current.getExpression()
      continue
    }
    return Node.isIdentifier(current)
      ? current.getText()
      : Node.isThisExpression(current)
        ? 'this'
        : null
  }
  return null
}

/**
 * `this.ui.table().row(x)`, `this.logger.info(x)`, `console.log(x)`: a chain rooted
 * at a printer — through a variable too (`const table = this.ui.table(); table.row(x)`).
 */
function isPrinter(receiver: Node, body: Node, depth = 0): boolean {
  let current: Node | undefined = receiver
  for (let steps = 0; current && steps < 20; steps++) {
    if (Node.isCallExpression(current)) {
      current = current.getExpression()
      continue
    }
    if (Node.isPropertyAccessExpression(current)) {
      const inner = current.getExpression()
      if (Node.isThisExpression(inner)) return PRINTERS.has(current.getName())
      current = inner
      continue
    }
    if (!Node.isIdentifier(current)) return false
    if (current.getText() === 'console') return true
    const bound = depth < 3 ? bindingOf(current.getText(), body) : null
    return !!bound && isPrinter(bound.initializer, body, depth + 1)
  }
  return false
}

/** `ctx.inertia` -> 'inertia', `inertia` -> 'inertia', `this.response` -> 'response' */
function lastSegmentOf(node: Node): string {
  if (Node.isPropertyAccessExpression(node)) return node.getName()
  return node.getText()
}

function classify(
  value: Expression | null,
  path: string,
  ctx: DeliveryContext,
  out: Delivery[],
  depth: number
): void {
  if (!value || depth > 6) return

  // `return null`, `return undefined`: nothing leaves on that path
  if (value.getKind() === SyntaxKind.NullKeyword) return
  if (Node.isIdentifier(value) && value.getText() === 'undefined') return

  /**
   * A constant with no key — `this.logger.info('done')`, a table's `head(['Nome'])`
   * — is a label or a message, not a field: AFP counts no message DET (§6). Keyed,
   * `{ titulo: 'X' }` is a value the page receives, and stays one.
   */
  if (
    !path &&
    (Node.isStringLiteral(value) ||
      Node.isNoSubstitutionTemplateLiteral(value) ||
      Node.isNumericLiteral(value))
  )
    return

  if (Node.isObjectLiteralExpression(value)) {
    for (const property of value.getProperties()) {
      if (Node.isShorthandPropertyAssignment(property)) {
        classify(property.getNameNode(), join(path, property.getName()), ctx, out, depth + 1)
      } else if (Node.isPropertyAssignment(property)) {
        // `{ [STATUS.A]: n, [STATUS.B]: m }`: a map — one repeating attribute, not one per key
        const name = Node.isComputedPropertyName(property.getNameNode())
          ? '*'
          : property.getName().replace(/^['"]|['"]$/g, '')
        classify(unwrap(property.getInitializer()), join(path, name), ctx, out, depth + 1)
      } else if (Node.isSpreadAssignment(property)) {
        classify(unwrap(property.getExpression()), path, ctx, out, depth + 1)
      } else {
        out.push({ kind: 'scalar', path: join(path, property.getName?.() ?? '*') })
      }
    }
    return
  }

  if (Node.isConditionalExpression(value)) {
    classify(unwrap(value.getWhenTrue()), path, ctx, out, depth + 1)
    classify(unwrap(value.getWhenFalse()), path, ctx, out, depth + 1)
    return
  }

  // `[...(destaque ? [destaque] : []), ...data]`: every element leaves
  if (Node.isArrayLiteralExpression(value)) {
    for (const element of value.getElements()) {
      classify(
        unwrap(Node.isSpreadElement(element) ? element.getExpression() : element),
        path,
        ctx,
        out,
        depth + 1
      )
    }
    return
  }

  // `rows[0]`: one row of the collection — the collection's store
  if (Node.isElementAccessExpression(value)) {
    classify(unwrap(value.getExpression()), path, ctx, out, depth + 1)
    return
  }

  if (Node.isIdentifier(value)) {
    const name = value.getText()
    if (ctx.symbols.has(name)) {
      out.push({ kind: 'store', store: ctx.symbols.get(name)!, path })
      return
    }
    const bound = bindingOf(name, ctx.body)
    if (bound) {
      // `const { data } = await q.handle()`: one key of what the call returns
      if (bound.pick && Node.isCallExpression(bound.initializer)) {
        classifyCall(bound.initializer, path, ctx, out, depth + 1, bound.pick)
        return
      }
      if (bound.pick && Node.isObjectLiteralExpression(bound.initializer)) {
        const picked = bound.initializer.getProperty(bound.pick)
        if (picked && Node.isPropertyAssignment(picked)) {
          classify(unwrap(picked.getInitializer()), path, ctx, out, depth + 1)
          return
        }
        if (picked && Node.isShorthandPropertyAssignment(picked)) {
          classify(picked.getNameNode(), path, ctx, out, depth + 1)
          return
        }
      }
      classify(bound.initializer, path, ctx, out, depth + 1)
      return
    }
    if (isEchoBinding(name, ctx.body)) {
      out.push({ kind: 'echo', path })
      return
    }
    out.push({ kind: 'scalar', path })
    return
  }

  if (Node.isCallExpression(value)) {
    classifyCall(value, path, ctx, out, depth)
    return
  }

  if (Node.isPropertyAccessExpression(value) || Node.isElementAccessExpression(value)) {
    classifyAccess(value, path, ctx, out, depth)
    return
  }

  if (Node.isAwaitExpression(value)) {
    classify(unwrap(value.getExpression()), path, ctx, out, depth + 1)
    return
  }

  // `q ?? null`, `page || 1`: the value with a default — the default says nothing; `a && b`: b
  if (Node.isBinaryExpression(value)) {
    const operator = value.getOperatorToken().getKind()
    if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) {
      classify(unwrap(value.getLeft()), path, ctx, out, depth + 1)
      return
    }
    if (operator === SyntaxKind.AmpersandAmpersandToken) {
      classify(unwrap(value.getRight()), path, ctx, out, depth + 1)
      return
    }
  }

  // `${assinantes.length} assinante(s)`: the values a template carries
  if (Node.isTemplateExpression(value)) {
    for (const span of value.getTemplateSpans())
      classify(unwrap(span.getExpression()), path, ctx, out, depth + 1)
    return
  }

  // literals, arithmetic, comparisons, `new Date()`: one value leaves
  out.push({ kind: 'scalar', path })
}

function classifyCall(
  value: CallExpression,
  path: string,
  ctx: DeliveryContext,
  out: Delivery[],
  depth: number,
  pick?: string
): void {
  {
    const callee = value.getExpression()
    const method = Node.isPropertyAccessExpression(callee) ? callee.getName() : ''

    if (
      Node.isPropertyAccessExpression(callee) &&
      ECHOES_INPUT.has(method) &&
      isRequestLike(callee.getExpression())
    ) {
      out.push({ kind: 'echo', path })
      return
    }

    // `xs.map((x) => ({ a, b }))`: a repeating group, its leaves once
    const mapped = mappedLiteralOf(value)
    if (mapped) {
      classify(mapped, path, ctx, out, depth + 1)
      return
    }
    if (method === 'map' && Node.isPropertyAccessExpression(callee)) {
      classifyMapped(value, callee.getExpression(), path, ctx, out, depth)
      return
    }

    // `paginator.all()`, `result.toJSON()`: the same value, unwrapped
    if (
      Node.isPropertyAccessExpression(callee) &&
      PASSES_THROUGH.has(method) &&
      value.getArguments().length === 0
    ) {
      classify(unwrap(callee.getExpression()), path, ctx, out, depth + 1)
      return
    }

    // Lucid's pagination meta: four values the page can show, or the one picked
    if (method === 'getMeta' && value.getArguments().length === 0) {
      if (pick) out.push({ kind: 'scalar', path })
      else for (const key of PAGINATOR_META) out.push({ kind: 'scalar', path: join(path, key) })
      return
    }

    // `rows.slice(0, 4)`, `rows.find(…)`: the same collection, or one of its rows
    if (Node.isPropertyAccessExpression(callee) && SAME_COLLECTION.has(method)) {
      classify(unwrap(callee.getExpression()), path, ctx, out, depth + 1)
      return
    }

    // `this.colors.red(situacao)`: the value, coloured — a coloured constant is a label, and drops
    if (
      Node.isPropertyAccessExpression(callee) &&
      lastSegmentOf(callee.getExpression()) === 'colors'
    ) {
      const coloured = unwrap(value.getArguments()[0])
      if (coloured) classify(coloured, path, ctx, out, depth + 1)
      return
    }

    // `inertia.defer(() => q.handle())`: the callback's value, delivered later
    if (
      Node.isPropertyAccessExpression(callee) &&
      INERTIA_LAZY.has(method) &&
      RENDERERS.has(lastSegmentOf(callee.getExpression()))
    ) {
      const callback = unwrap(value.getArguments()[0])
      const body = callbackValueOf(callback)
      if (body) classify(body, path, ctx, out, depth + 1)
      else out.push({ kind: 'scalar', path })
      return
    }

    const args: Delivery[] = []
    for (const argument of value.getArguments())
      classify(unwrap(argument), path, ctx, args, depth + 1)
    /** only what carries rows matters for a fallback: a scalar argument is a parameter, not an output */
    const carried = args.filter((item) => item.kind === 'store' || item.kind === 'call')

    // `env.get('APP_URL')`, `i18n.t('key')`: a framework service hands back one value — a strategy may have "followed" it into `#start/env`, where there is no body
    if (Node.isPropertyAccessExpression(callee)) {
      const root = chainRootOf(callee.getExpression())
      if (root && SCALAR_SERVICES.has(root)) {
        out.push({ kind: 'scalar', path })
        return
      }
    }

    const refs = ctx.followed.get(value)
    if (refs && refs.length > 0) {
      out.push({
        kind: 'call',
        refs,
        path,
        expression: value.getText().replace(/\s+/g, '').slice(0, 60),
        args: carried,
        ...(pick ? { pick } : {}),
      })
      return
    }

    // `Form.all()`, `Produto.query()…` handed straight to the response
    const access = detectAccess(value, ctx.symbols, ctx.relations)
    if (access) {
      out.push({ kind: 'store', store: access.store, path })
      if (access.viaRelation) out.push({ kind: 'store', store: access.viaRelation, path })
      return
    }

    // `Number(x)`, `String(x)`, `Object.values(Enum)`, `JSON.stringify(x)`: one value, or a constant list
    if (Node.isIdentifier(callee) && NATIVE_GLOBALS.has(callee.getText())) {
      out.push({ kind: 'scalar', path })
      return
    }
    if (
      Node.isPropertyAccessExpression(callee) &&
      Node.isIdentifier(callee.getExpression()) &&
      NATIVE_GLOBALS.has(callee.getExpression().getText())
    ) {
      out.push({ kind: 'scalar', path })
      return
    }

    /**
     * A call nobody followed, over rows: a package's CSV builder, a formatter. The
     * document it builds carries what was handed into it, so the rows' stores leave.
     * With nothing flowing in there is nothing to say: one DET, opaque, reported.
     */
    if (carried.length > 0) {
      out.push(...carried)
      return
    }

    /**
     * `startDate?.toISOString()`, `categoria.trim()`: a call ON a value the body
     * holds is that value formatted — an echo stays an echo, a store's field one
     * field. Only when the root itself resolves to nothing else is the call read
     * on its own.
     */
    if (Node.isPropertyAccessExpression(callee)) {
      const root = chainRootOf(callee.getExpression())
      if (root && ctx.symbols.has(root)) {
        out.push({ kind: 'scalar', path })
        return
      }
      if (root && root !== 'this') {
        const rootNode = rootIdentifierOf(callee.getExpression())
        const held: Delivery[] = []
        if (rootNode) classify(rootNode, path, ctx, held, depth + 1)
        if (held.length > 0 && held.every((item) => item.kind === 'echo')) {
          out.push({ kind: 'echo', path })
          return
        }
      }
    }

    /**
     * `rows.map(…).join('\n')` in a body whose parameter is `rows`: the whole input
     * transformed, so the input says what leaves — the caller's arguments decide,
     * and the body itself says nothing. `noticia.publicadaEm?.toISO()` on that
     * parameter is one FIELD of it, and stays one value below.
     */
    if (Node.isPropertyAccessExpression(callee) && transformsParameter(callee, ctx.body)) {
      out.push({
        kind: 'opaque',
        path,
        expression: value.getText().replace(/\s+/g, '').slice(0, 60),
      })
      return
    }

    if (Node.isPropertyAccessExpression(callee)) {
      /**
       * `comunicado.enviadoEm!.toISODate()`, `(a ?? b).toRFC2822()`: a FIELD read off
       * the chain, or an expression, then a method — one value. A chain rooted at
       * `this` (`this.service.find()`) is a call into a service, and not this.
       */
      if (readsField(callee.getExpression())) {
        out.push({ kind: 'scalar', path })
        return
      }
      // `bouncer.with(P).allows('create')`, `x.toISO()`: a yes/no or a value formatted
      if (BOOLEAN_METHODS.has(method) || FORMAT_METHODS.has(method)) {
        out.push({ kind: 'scalar', path })
        return
      }
    }

    // a call whose declared return type is a primitive: one value, named by its key — not opaque
    if (returnsPrimitive(value)) {
      out.push({ kind: 'scalar', path })
      return
    }

    out.push({ kind: 'opaque', path, expression: value.getText().replace(/\s+/g, '').slice(0, 60) })
  }
}

/**
 * `xs.map(cb)` with no literal in the callback: what the callback RETURNS,
 * once — a function passed by reference (`rows.map(paraLinha)`) is a call to
 * that function over the rows; an expression body (`(m) => new T(m).toObject()`)
 * is classified as if it were the value; anything else is one repeating attribute.
 */
function classifyMapped(
  value: CallExpression,
  receiver: Expression,
  path: string,
  ctx: DeliveryContext,
  out: Delivery[],
  depth: number
): void {
  const callback = unwrap(value.getArguments()[0])

  // `rows.map(paraLinha)`: the strategies followed the function named — a call to it over the rows
  const refs = ctx.followed.get(value)
  if (callback && Node.isIdentifier(callback) && refs && refs.length > 0) {
    const rows: Delivery[] = []
    classify(unwrap(receiver), path, ctx, rows, depth + 1)
    out.push({
      kind: 'call',
      refs,
      path,
      expression: value.getText().replace(/\s+/g, '').slice(0, 60),
      args: rows.filter((item) => item.kind === 'store' || item.kind === 'call'),
    })
    return
  }

  const body = callbackValueOf(callback)
  if (body) {
    classify(body, path, ctx, out, depth + 1)
    return
  }

  out.push({ kind: 'scalar', path })
}

/** the value a callback hands back: an expression body, or the one `return` of a block */
function callbackValueOf(callback: Expression | null): Expression | null {
  if (!callback || !(Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)))
    return null
  const body = callback.getBody()
  if (!Node.isBlock(body)) return unwrap(body)
  const returns = body.getStatements().filter(Node.isReturnStatement)
  return returns.length === 1 ? unwrap(returns[0].getExpression()) : null
}

/**
 * Does this chain read a property (not a method) or hold an expression before
 * the method is applied? `comunicado.enviadoEm.toISO()` does; `rows.map(f).join()`
 * does not; a chain rooted at `this` is a service, and does not.
 */
function readsField(node: Node): boolean {
  let current: Node | undefined = node
  for (let depth = 0; current && depth < 40; depth++) {
    if (Node.isCallExpression(current)) {
      const inner: Node = current.getExpression()
      current = Node.isPropertyAccessExpression(inner) ? inner.getExpression() : inner
      continue
    }
    if (Node.isAwaitExpression(current) || Node.isNonNullExpression(current)) {
      current = current.getExpression()
      continue
    }
    if (Node.isParenthesizedExpression(current)) {
      const inner = unwrap(current.getExpression())
      if (!inner) return false
      if (Node.isBinaryExpression(inner) || Node.isConditionalExpression(inner)) return true
      current = inner
      continue
    }
    if (Node.isPropertyAccessExpression(current) || Node.isElementAccessExpression(current)) {
      return chainRootOf(current) !== 'this'
    }
    return false
  }
  return false
}

/**
 * Is this chain a method (or methods) applied to a plain parameter of the body,
 * with no field read in between? `rows.map(f).join(s)` is; `noticia.capa?.toISO()`
 * reads a field first and is not.
 */
function transformsParameter(
  callee: import('ts-morph').PropertyAccessExpression,
  body: Node
): boolean {
  let current: Node | undefined = callee.getExpression()
  for (let depth = 0; current && depth < 40; depth++) {
    if (Node.isCallExpression(current)) {
      const inner: Node = current.getExpression()
      // the method of that call, then its receiver
      current = Node.isPropertyAccessExpression(inner) ? inner.getExpression() : inner
      continue
    }
    if (
      Node.isAwaitExpression(current) ||
      Node.isParenthesizedExpression(current) ||
      Node.isNonNullExpression(current)
    ) {
      current = current.getExpression()
      continue
    }
    // a property read off the chain, not a method: one field of the input
    if (Node.isPropertyAccessExpression(current) || Node.isElementAccessExpression(current))
      return false
    if (!Node.isIdentifier(current)) return false
    const name = current.getText()
    return (
      Node.isParametered(body) &&
      body
        .getParameters()
        .some((p) => Node.isIdentifier(p.getNameNode()) && p.getNameNode().getText() === name)
    )
  }
  return false
}

/** the identifier node a chain is rooted at: `startDate?.toISOString` -> `startDate` */
function rootIdentifierOf(node: Node): Identifier | null {
  let current: Node | undefined = node
  for (let depth = 0; current && depth < 40; depth++) {
    if (
      Node.isCallExpression(current) ||
      Node.isPropertyAccessExpression(current) ||
      Node.isElementAccessExpression(current) ||
      Node.isAwaitExpression(current) ||
      Node.isParenthesizedExpression(current) ||
      Node.isNonNullExpression(current)
    ) {
      current = current.getExpression()
      continue
    }
    return Node.isIdentifier(current) ? current : null
  }
  return null
}

/** the call's declared return type, `Promise<…>` unwrapped, is a boolean, string, number or a union of those */
function returnsPrimitive(call: CallExpression): boolean {
  try {
    let type: Type = call.getReturnType()
    if (type.getSymbol()?.getName() === 'Promise') type = type.getTypeArguments()[0] ?? type
    const primitive = (t: Type) =>
      t.isBoolean() ||
      t.isBooleanLiteral() ||
      t.isString() ||
      t.isStringLiteral() ||
      t.isNumber() ||
      t.isNumberLiteral() ||
      t.isEnumLiteral() ||
      t.isNull() ||
      t.isUndefined()
    if (type.isUnion()) {
      const members = type.getUnionTypes()
      return (
        members.length > 0 &&
        members.every(primitive) &&
        !members.every((t) => t.isNull() || t.isUndefined())
      )
    }
    return primitive(type)
  } catch {
    return false
  }
}

/**
 * `x.data`, `resultado.linhas`, `rows[0]`: a part of a value the body holds.
 *
 *   on a variable bound to a followed call    that key of what the call returns
 *   on a store-bound variable                 the store (`rows[0]`, `.data`) or a field (scalar)
 *   on the validated payload or the request   an echo of input — counts on entry
 *   anything else                             one value
 */
function classifyAccess(
  value: import('ts-morph').PropertyAccessExpression | import('ts-morph').ElementAccessExpression,
  path: string,
  ctx: DeliveryContext,
  out: Delivery[],
  depth: number
): void {
  const root = rootSymbolOf(value)
  /**
   * `x.nome`, `x['nome']`: the key named; `x[papel]`: a key the body computes — one
   * value, unnamed (`*`); `rows[0]`: one row of the collection, the collection.
   */
  const property = Node.isPropertyAccessExpression(value)
    ? value.getName()
    : keyOfElementAccess(value)

  if (root && ctx.symbols.has(root)) {
    // `rows[0]`, `rows.data`: the rows; `produto.nome`: one field
    if (!property || PASSES_THROUGH.has(property))
      out.push({ kind: 'store', store: ctx.symbols.get(root)!, path })
    else out.push({ kind: 'scalar', path: path || property.replace(/^\*$/, '') })
    return
  }

  if (root) {
    const bound = bindingOf(root, ctx.body)
    if (bound && Node.isCallExpression(bound.initializer)) {
      if (SCALAR_PROPS.has(property)) {
        out.push({ kind: 'scalar', path })
        return
      }
      /**
       * `resultado.linhas`: one key of what the call returns; `meta.pagina` on a
       * destructured `meta`: the key under the key; `rows[0]`, `.data`: the whole.
       */
      const own = property && !PASSES_THROUGH.has(property) ? property : undefined
      const pick = [bound.pick, own].filter(Boolean).join('.') || undefined
      // `user.email` on a call nobody followed: whatever the call is, this is one field of it
      if (own && !ctx.followed.has(bound.initializer)) {
        out.push({ kind: 'scalar', path })
        return
      }
      classifyCall(bound.initializer, path, ctx, out, depth + 1, pick)
      return
    }
    if (bound && Node.isObjectLiteralExpression(bound.initializer) && property) {
      const picked = bound.initializer.getProperty(property)
      if (picked && Node.isPropertyAssignment(picked)) {
        classify(unwrap(picked.getInitializer()), path, ctx, out, depth + 1)
        return
      }
    }
    if (isEchoBinding(root, ctx.body) || root === 'request' || root === 'params') {
      out.push({ kind: 'echo', path })
      return
    }
  }

  // `table.row([assinante.nome, assinante.email])`: a field delivered with no key takes the field's name
  out.push({ kind: 'scalar', path: path || property.replace(/^\*$/, '') })
}

function keyOfElementAccess(value: import('ts-morph').ElementAccessExpression): string {
  const argument = unwrap(value.getArgumentExpression())
  if (!argument || Node.isNumericLiteral(argument)) return ''
  if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
    return argument.getLiteralValue()
  return '*'
}

const join = (prefix: string, name: string) => (prefix ? `${prefix}.${name}` : name)

/** `await x` binds x: the value, not the promise */
function unwrapAwait(node: Node | undefined): Expression | null {
  let current = unwrap(node)
  while (current && Node.isAwaitExpression(current)) current = unwrap(current.getExpression())
  return current
}

/**
 * How a local name was bound in this body: `const x = …` gives the initializer;
 * `const { x, y } = …` gives the initializer and the key picked out of it.
 */
function bindingOf(name: string, body: Node): { initializer: Expression; pick?: string } | null {
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = declaration.getNameNode()
    if (Node.isIdentifier(nameNode)) {
      if (nameNode.getText() !== name) continue
      const initializer = unwrapAwait(declaration.getInitializer())
      return initializer ? { initializer } : null
    }
    if (Node.isObjectBindingPattern(nameNode)) {
      const element = nameNode.getElements().find((e) => e.getName() === name)
      if (!element) continue
      const initializer = unwrapAwait(declaration.getInitializer())
      if (!initializer) return null
      // `{ data: rows }` renames: the key is the property name, the local is the alias
      const pick = element.getPropertyNameNode()?.getText() ?? element.getName()
      return { initializer, pick }
    }
  }
  return null
}

/**
 * A name bound by destructuring the validated payload or the request:
 * `const { busca } = await request.validateUsing(x)`, `const { id } = params`.
 */
function isEchoBinding(name: string, body: Node): boolean {
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const binding = declaration.getNameNode()
    if (!Node.isObjectBindingPattern(binding)) continue
    if (!binding.getElements().some((element) => element.getName() === name)) continue
    const initializer = unwrap(declaration.getInitializer())
    if (!initializer) continue
    if (Node.isIdentifier(initializer) && /^(params|request)$/.test(initializer.getText()))
      return true
    if (Node.isCallExpression(initializer)) {
      const callee = initializer.getExpression()
      if (Node.isPropertyAccessExpression(callee) && ECHOES_INPUT.has(callee.getName())) return true
    }
  }
  return false
}

const isRequestLike = (node: Node) => lastSegmentOf(node) === 'request'
