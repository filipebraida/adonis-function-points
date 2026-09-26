import { createHash } from 'node:crypto'
import { Node, Project, SyntaxKind } from 'ts-morph'
import type {
  CallExpression,
  ClassDeclaration,
  ObjectLiteralExpression,
  ParameterDeclaration,
  PropertyDeclaration,
  SourceFile,
} from 'ts-morph'

import type { AppContext } from '../app_context.js'
import type { CollectedDataStore } from '../sources/data_stores.js'
import { detectAccess, hooksFiredBy, rootSymbolOf } from '../detectors/lucid.js'
import type { PersistenceAccess, RelationMap, StoreSymbols } from '../detectors/lucid.js'
import { BUILTIN_CALL_RESOLVERS, isTechnicalWrite, resolveCall } from '../resolvers/index.js'
import { isApplicationCode, isSeeder, toPosix } from '../paths.js'
import type { EventBindings } from '../sources/event_bindings.js'
import { isIterationCall, isNoise, isNoiseMember } from './noise.js'
import { chainShapeOf, outputFieldsIn } from './output_fields.js'
import type { StoreRead } from './output_fields.js'
import { PASSES_ROWS, deliveriesIn } from './deliveries.js'
import { readPages } from './pages.js'
import type { RawDelivery } from './pages.js'
import { commandFieldsOf, isCommandClass } from '../sources/commands.js'
import type { Delivery } from './deliveries.js'
import type { CallResolver, ResolverContext } from '../resolvers/types.js'
import type { HandlerRef, TraceStep, UnresolvedCall } from '../../types.js'

/**
 * The transaction → data function graph. It is the backbone of the count.
 *
 * Three of the four boundary decisions are settled here: a static route does
 * not count because it reaches no data; a route from a package likewise; a
 * model hook counts because it lies on the path. And AFP requires aggregating
 * ALL reachable paths:
 *
 *   "When the static code analyzer finds multiple optional paths in the context
 *    of a transaction, it shall consider these multiple optional paths to be
 *    part of the same transaction."  — AFP §6.5.3
 *
 * Traversal is at METHOD level, never at file level: a domain service holds
 * many writes, and asking about the file would mark everyone importing it as a
 * writer.
 */

export type ScopeEntry = {
  file: string
  member?: string
  /** hash of the normalised AST — counting-decisions §5 */
  bodyHash: string
}

export type Behavior = {
  writes: boolean
  /** data stores reached */
  touches: string[]
  /**
   * Of those, the ones this transaction WRITES.
   *
   * `writes` is a property of the transaction — it decides EI against EO — and was
   * being read as a property of every store the transaction touched: a table merely
   * read by a route that writes something else counted as maintained, so almost
   * nothing could be an EIF. §6.5.4 asks who maintains THIS store, which is a
   * question about the access, not about the request.
   */
  writtenStores: string[]
  /**
   * Declared input fields: `request.validateUsing(x)` resolved down to the
   * fields of the VineJS schema — counting-decisions §7.
   */
  inputFields: string[]
  /** input fields that enumerate nothing: an open `vine.object` */
  opaqueInputFields: string[]
  /**
   * Fields read straight off the request. Kept apart from `inputFields` so the
   * conformance metric keeps meaning what it says: these are DETs, and they are
   * not a validator.
   */
  requestFields: string[]
  /** an ace command's `@flags.*` / `@args.*`: `flags.limite`, `args.name` — its input DETs */
  commandFields: string[]
  /** the transaction reads the request in a way that enumerates nothing */
  opaqueRequest: boolean
  /**
   * What leaves the boundary, when a transformer on the path says so —
   * counting-decisions §6. Qualified by the transformer: `LivroTransformer.titulo`.
   *
   * Empty means no transformer was reached, and the output DETs fall back to the
   * columns of the stores read. It does NOT mean the transaction emits nothing.
   */
  outputFields: string[]
  /** of those, the spreads the walker could not read: 1 DET each, a floor, reported */
  opaqueOutputFields: string[]
  /** stores a transformer on the path is FOR: their columns are not output DETs, their keys are */
  transformedStores: string[]
  /**
   * How each store was read, over every chain on the path: whether rows left
   * whole, which columns a `.select()` named, and whether an aggregate
   * (`.count()`, `.exists()`) left one scalar. What an output shows when no
   * transformer covers the store.
   */
  outputReads: Record<
    string,
    {
      whole: boolean
      selected: string[]
      aggregate: boolean
      /** read by a chain of its own, not only preloaded through another store */
      direct: boolean
      /** stores it was preloaded through */
      via: string[]
    }
  >
  /**
   * What the transaction DELIVERS — plan 0.7 §A′. `any` says a delivery point was
   * found at all; without one the output falls back to the stores read. `fields`
   * are derived values and the leaves of literals a followed body returned,
   * `render:total`; `stores` are the ones whose rows were handed on, raw or through
   * a query object; `opaqueFields` are values nobody could read, 1 DET each.
   */
  delivered: { any: boolean; fields: string[]; opaqueFields: string[]; stores: string[] }
  /**
   * Of the stores delivered raw to a page, the columns the page reads off them
   * (plan 0.8 §D). A store absent here leaves whole; one in `unreadablePages` leaves
   * whole because the page could not be read, and says why.
   */
  pageReads: Record<string, string[]>
  unreadablePages: Record<string, string>
  trace: TraceStep[]
  /** bodies reached, for `fp:diff` */
  scope: ScopeEntry[]
  unresolved: UnresolvedCall[]
}

/**
 * Fields declared by the validators used in this body.
 *
 * `request.validateUsing(createBookValidator)` -> resolve the validator ->
 * count the leaves of the `vine.object`, per the table in counting-decisions §7:
 *
 *   scalar                           1
 *   nested object                    leaves counted individually
 *   array of scalar                  1  (repeating group)
 *   array of object                  leaves, counted once
 *   unresolved spread                0, and reported — never guessed
 */
function validatorFieldsIn(
  body: Node,
  file: SourceFile,
  app: AppContext
): { fields: string[]; opaque: string[] } {
  const fields: string[] = []
  const opaque: string[] = []

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression()
    if (!Node.isPropertyAccessExpression(expression)) continue
    if (expression.getName() !== 'validateUsing') continue

    const argument = call.getArguments()[0]
    if (!argument || !Node.isIdentifier(argument)) continue

    const name = argument.getText()
    const declaration = findValidator(name, file, app)
    if (!declaration) continue

    /**
     * The reference is resolved in the VALIDATOR's file, not the caller's.
     *
     * `vine.object({}).merge(openaiOrAws)` names a constant that lives beside the
     * validator and is usually not exported, so looking for it where the call site
     * is finds nothing — which is how five fields stayed invisible.
     */
    const { leaves, opaque: unreadable } = leavesOf(declaration, (ref) =>
      findValidator(ref, declaration.getSourceFile(), app)
    )
    const isOpaque = new Set(unreadable)

    for (const leaf of leaves) {
      const field = `${name}.${leaf}`
      fields.push(field)
      if (isOpaque.has(leaf)) opaque.push(field)
    }
  }

  return { fields, opaque }
}

/**
 * Fields read straight off the request, with no validator in between.
 *
 * `request.input('title')` is a user-recognisable field crossing the boundary —
 * §7.2's definition of a DET — and it was worth nothing, because input DETs came
 * only from VineJS. A transaction that reads six fields this way landed at 1 DET
 * and therefore at the floor of its complexity band.
 *
 * On four production applications about half the submitting transactions have no
 * validator, so this was not an edge case: it was a systematic undercount, and a
 * silent one.
 *
 * `all()`, `body()`, `except()` and `qs()` enumerate nothing — they read whatever
 * arrives. Those are the honest blind spot, reported rather than guessed, which
 * is why they come back as a flag and not as a field.
 */
const ENUMERATES_FIELDS = new Set(['input', 'only'])
const READS_OPAQUELY = new Set(['all', 'body', 'except', 'qs'])

function requestFieldsIn(body: Node): { fields: string[]; opaque: boolean } {
  const fields = new Set<string>()
  let opaque = false

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression()
    if (!Node.isPropertyAccessExpression(expression)) continue
    if (!isRequest(expression.getExpression())) continue

    const method = expression.getName()
    if (READS_OPAQUELY.has(method)) {
      opaque = true
      continue
    }
    if (!ENUMERATES_FIELDS.has(method)) continue

    const argument = call.getArguments()[0]
    if (!argument) continue

    /** `request.input('title')` */
    const single = argument.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
    if (single) {
      fields.add(single)
      continue
    }

    /** `request.only(['title', 'isbn'])` */
    const list = argument.asKind(SyntaxKind.ArrayLiteralExpression)
    if (!list) {
      opaque = true
      continue
    }
    for (const element of list.getElements()) {
      const name = element.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
      if (name) fields.add(name)
      else opaque = true
    }
  }

  return { fields: [...fields], opaque }
}

/**
 * `request` as an AdonisJS handler receives it: destructured from the context,
 * or reached through it. Resolved by shape, not by a name list — `ctx.request`
 * and `{ request }` are the same object.
 */
function isRequest(receiver: Node): boolean {
  if (Node.isIdentifier(receiver)) return receiver.getText() === 'request'
  return Node.isPropertyAccessExpression(receiver) && receiver.getName() === 'request'
}

/** validator declaration: in this file, or imported from the application */
function findValidator(name: string, file: SourceFile, app: AppContext): Node | null {
  const local = file.getVariableDeclaration(name)?.getInitializer()
  if (local) return local

  for (const declaration of file.getImportDeclarations()) {
    const names = declaration.getNamedImports().map((named) => named.getName())
    if (!names.includes(name)) continue

    const target = app.resolveSpecifier(declaration.getModuleSpecifierValue())
    if (!target) continue

    const source = file.getProject().getSourceFile(target)
    const initializer = source?.getVariableDeclaration(name)?.getInitializer()
    if (initializer) return initializer
  }

  return null
}

/**
 * Leaves of a VineJS schema, per the table in §7, and which of them are opaque.
 *
 * `answers: vine.object({}).allowUnknownProperties()` declares a field whose own
 * fields live in data, not in code. Walking into the empty literal found nothing
 * and then never pushed `answers` either, so the field counted ZERO — while an
 * opaque JSON column in the same position counts 1. The two are the same
 * situation and now get the same answer: one DET, and a warning that says the
 * number is a floor.
 *
 * That zero is also why `detFromSchema` was off by one. Its formula replaces the
 * opaque placeholder with the schema's fields, and there was no placeholder to
 * replace, so the subtraction ate a real field instead.
 */
/**
 * Is this literal the argument of a call named `name`?
 *
 * Structural, because the test used to be a regex over the property's source text
 * (`/vine\.object/`) and Prettier breaks a long chain across lines:
 *
 *     data: vine
 *       .object({})
 *       .allowUnknownProperties()
 *
 * `vine` and `.object` then sit on different lines, the regex misses, and the field
 * silently stops being recognised as an open object. A count that depends on where
 * the formatter put a newline is not a measurement — the same reason the
 * implementation-scope hash strips whitespace before hashing.
 */
function isArgumentOfCallNamed(literal: ObjectLiteralExpression, name: string): boolean {
  const call = literal.getParent()
  if (!call || !Node.isCallExpression(call)) return false

  const callee = call.getExpression()
  return Node.isPropertyAccessExpression(callee) && callee.getName() === name
}

/** The last member of a call's callee: `vine.group.if(…)` is `if`, however it is wrapped. */
function calleeName(call: CallExpression): string | undefined {
  const callee = call.getExpression()
  return Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined
}

/** …and the member before it, so `group.if` can be told from any other `if`. */
function calleeOwner(call: CallExpression): string | undefined {
  const callee = call.getExpression()
  if (!Node.isPropertyAccessExpression(callee)) return undefined

  const owner = callee.getExpression()
  return Node.isPropertyAccessExpression(owner) ? owner.getName() : undefined
}

type SchemaLeaves = { leaves: string[]; opaque: string[] }

function leavesOf(node: Node, resolveRef?: (name: string) => Node | null): SchemaLeaves {
  const object = node.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression)
  if (!object) return { leaves: [], opaque: [] }

  const leaves: string[] = []
  const opaque: string[] = []

  const walk = (literal: typeof object, prefix: string) => {
    for (const property of literal.getProperties()) {
      // an unresolved spread counts 0: better missing than guessed
      if (!Node.isPropertyAssignment(property)) continue

      const name = property.getName().replace(/['"]/g, '')
      const nested = property.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression)

      // nested `vine.object({...})`: leaves count individually
      // `vine.array(vine.object({...}))`: repeating group, leaves counted once
      if (nested && isArgumentOfCallNamed(nested, 'object')) {
        const path = prefix ? `${prefix}.${name}` : name

        /**
         * An object declaring no properties enumerates nothing. It is the field
         * itself that crosses the boundary, so it counts once — never zero,
         * which would make it cheaper than a plain string.
         */
        if (nested.getProperties().length === 0) {
          leaves.push(path)
          opaque.push(path)
          continue
        }

        walk(nested, path)
        continue
      }

      leaves.push(prefix ? `${prefix}.${name}` : name)
    }
  }

  walk(object, '')

  /**
   * Conditional groups: `vine.object({}).merge(vine.group([vine.group.if(p, {…})]))`.
   *
   * The branches are mutually exclusive at runtime and the transaction can carry
   * any of them, so §7.2 counts the UNION — the fields the elementary process
   * handles. Read from the first object literal alone, the whole validator looked
   * like an open object and the count said the fields were data when they are
   * plainly in the code: five fields reported as one, and `detFromSchema` could not
   * fix it, because a group is not a JSON Schema.
   *
   * A `group.if` literal inside the outer object would be a nested schema `walk`
   * already handled, so only the ones outside it are roots here.
   */
  for (const branch of groupBranchesIn(node, object, resolveRef)) {
    walk(branch, '')
  }

  /**
   * The whole validator is an open object: nothing is enumerable, and the body
   * that carries it is measured at the floor. Counted as one, reported as such.
   */
  if (leaves.length === 0 && object.getProperties().length === 0) {
    return { leaves: ['*'], opaque: ['*'] }
  }

  return { leaves: [...new Set(leaves)], opaque: [...new Set(opaque)] }
}

/**
 * Object literals passed to `vine.group.if(…)`, following `.merge(x)` when `x` is
 * a name this file can resolve.
 *
 * The groups usually live in their own constant — which is why following the
 * reference matters more than recognising the inline form.
 */
function groupBranchesIn(
  node: Node,
  outer: ObjectLiteralExpression,
  resolveRef?: (name: string) => Node | null,
  depth = 0
): ObjectLiteralExpression[] {
  if (depth > 3) return []

  const found: ObjectLiteralExpression[] = []

  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const method = calleeName(call)

    if ((method === 'if' || method === 'else') && calleeOwner(call) === 'group') {
      for (const argument of call.getArguments()) {
        const literal = argument.asKind(SyntaxKind.ObjectLiteralExpression)
        // inside the outer object it is a nested schema, which `walk` already reads
        if (literal && !outer.getDescendants().includes(literal)) found.push(literal)
      }
      continue
    }

    /** `.merge(openaiOrAws)`: the group is declared elsewhere */
    if (method !== 'merge' || !resolveRef) continue

    const reference = call.getArguments()[0]
    if (!reference || !Node.isIdentifier(reference)) continue

    const declaration = resolveRef(reference.getText())
    if (declaration) found.push(...groupBranchesIn(declaration, outer, resolveRef, depth + 1))
  }

  return found
}

/** file name, to identify the unresolved call without dumping the full path */
const pathOf = (file: string) => file.split('/').pop()?.replace(/\.ts$/, '') ?? file

/** facts about a body, independent of who called it */
type BodyFacts = {
  accesses: { store: string; write: boolean; technical?: boolean }[]
  /** validators used in this body */
  validators: string[]
  /** the command's flags and arguments, when the body belongs to an ace command */
  commandFields: string[]
  /** validator fields that enumerate nothing: an open `vine.object` */
  opaqueValidators: string[]
  /** fields read straight off the request, with no validator in between */
  requestFields: string[]
  /** the body reads the request in a way that enumerates nothing */
  opaqueRequest: boolean
  /** keys this body emits, when it is a transformer method — §6 */
  outputs: string[]
  opaqueOutputs: string[]
  /** the store the transformer body is for, when it is one */
  transformed: string | null
  /** how the read chains of this body read each store */
  reads: StoreRead[]
  /** what this body hands to a renderer or a response, and what its `return` hands back */
  deliveries: import('./deliveries.js').BodyDeliveries
  followUps: { ref: HandlerRef; by: string; technical?: boolean }[]
  unresolved: UnresolvedCall[]
  bodyHash: string
}

export type GraphOptions = {
  /** how far to follow from the handler; the default comes from configuration */
  maxDepth?: number
  /**
   * Custom strategies, added to the built-in ones and ordered by `order`.
   *
   * This is what makes tracing extensible: AdonisJS imposes no organisation
   * pattern, so a project with its own convention registers it here.
   */
  callResolvers?: CallResolver[]
  /**
   * Which listeners each event reaches. Collected by the caller, because the
   * binding lives in a preload file and is an application-wide fact, like the
   * data stores.
   */
  eventBindings?: EventBindings
}

const DEFAULT_MAX_DEPTH = 3

/**
 * Analyzer with state shared across handlers.
 *
 * The ts-morph `Project` and the symbol cache are expensive to build and
 * identical for every handler of the same application. Creating one per handler
 * multiplies the cost by the number of routes, which is the difference between
 * minutes and seconds on an application of a few hundred routes.
 */
export function createAnalyzer(
  app: AppContext,
  stores: CollectedDataStore[],
  options: GraphOptions = {}
) {
  const eventBindings = options.eventBindings ?? new Map()

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  })

  /**
   * Every file is loaded up front.
   *
   * Adding a file part-way through the analysis invalidates the TypeScript
   * program, and the next query to the checker rebuilds it — a cost paid once
   * per route, uniformly. Loading everything first trades N rebuilds for one.
   */
  for (const root of app.scanRoots) {
    project.addSourceFilesAtPaths(`${root}/**/*.ts`)
  }
  /**
   * Seeders under `database/` as well — not application code, and never followed
   * from a handler, but an EIF only a seed populates is a fact the report needs
   * (counting-decisions §11), and `make:seeder` puts them exactly there.
   */
  project.addSourceFilesAtPaths(`${toPosix(app.root)}/database/**/seeders/**/*.ts`)

  const storesByName = new Map(stores.map((store) => [store.name, store]))
  const relationsByStore: RelationMap = new Map(
    stores.map((store) => [store.name, store.relations])
  )
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH

  const resolvers = [...(options.callResolvers ?? []), ...BUILTIN_CALL_RESOLVERS].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100)
  )

  const files = new Map<string, SourceFile | null>()
  const sourceFile = (absPath: string): SourceFile | null => {
    if (!files.has(absPath)) {
      files.set(
        absPath,
        project.getSourceFile(absPath) ?? project.addSourceFileAtPathIfExists(absPath) ?? null
      )
    }
    return files.get(absPath) ?? null
  }

  /** imports per file, computed once */
  const importCache = new Map<
    string,
    { imports: Map<string, string>; exportedAs: Map<string, string> }
  >()
  const importsFor = (file: SourceFile) => {
    const key = file.getFilePath()
    let cached = importCache.get(key)
    if (!cached) {
      cached = importMapsOf(file, app)
      importCache.set(key, cached)
    }
    return cached
  }

  /**
   * Facts about a body: what it accesses and where it calls into.
   *
   * They are INDEPENDENT of the caller — only the decision to follow depends on
   * depth. Without this cache a shared service is re-analysed once per route
   * that reaches it, and the cost grows with routes × depth.
   */
  /**
   * Hook methods of a model, by the decorators an access fires.
   *
   * The model file comes from the store's own provenance, so this asks the
   * inventory rather than guessing a path. Cached per store and method because
   * a transaction can touch the same model many times.
   */
  const hookCache = new Map<string, HandlerRef[]>()

  const hookRefsFor = (access: PersistenceAccess): HandlerRef[] => {
    const decorators = hooksFiredBy(access)
    if (decorators.length === 0) return []

    const key = `${access.store}#${access.method}`
    const cached = hookCache.get(key)
    if (cached) return cached

    const store = storesByName.get(access.store)
    const modelFile = store ? sourceFile(store.provenance.file) : null
    const wanted = new Set(decorators)

    const refs: HandlerRef[] = []
    for (const cls of modelFile?.getClasses() ?? []) {
      for (const method of cls.getMethods()) {
        const fires = method.getDecorators().some((decorator) => wanted.has(decorator.getName()))
        if (fires) refs.push({ file: store!.provenance.file, member: method.getName() })
      }
    }

    hookCache.set(key, refs)
    return refs
  }

  const factsCache = new Map<string, BodyFacts | null>()

  const factsFor = (ref: HandlerRef): BodyFacts | null => {
    const key = `${ref.file}#${ref.member ?? ref.line ?? '*'}`
    if (factsCache.has(key)) return factsCache.get(key) ?? null

    const facts = computeFacts(ref)
    factsCache.set(key, facts)
    return facts
  }

  /** store name by the posix path of the model that declares it */
  const storeByFile = new Map<string, string>()
  for (const [name, store] of storesByName) storeByFile.set(toPosix(store.provenance.file), name)

  /**
   * The guard's user: `auth.user`, `auth.getUserOrFail()` are rows of the model
   * `config/auth.ts` names in its provider (`model: () => import('#models/user')`).
   * Read, never assumed — an application with no such config binds nothing.
   */
  const authUserStore = ((): string | null => {
    const config = project.addSourceFileAtPathIfExists(`${toPosix(app.root)}/config/auth.ts`)
    if (!config) return null
    for (const call of config.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue
      if (call.getFirstAncestorByKind(SyntaxKind.PropertyAssignment)?.getName() !== 'model')
        continue
      const specifier = call.getArguments()[0]
      if (!specifier || !Node.isStringLiteral(specifier)) continue
      const target = app.resolveSpecifier(specifier.getLiteralValue())
      const store = target ? storeByFile.get(toPosix(target)) : undefined
      if (store) return store
    }
    return null
  })()

  /**
   * What a body's locals ARE — plan 0.8 §A. `storeSymbolsFor` binds what the
   * parameters and the static imports say; this pass, run in source order before
   * the accesses are detected, binds what the body's own statements say:
   *
   *   const s = await this.sessoes.ativa(d)        the followed body's return type,
   *                                                or its returns when unannotated
   *   const n = id ? await N.find(id) : new N()    a conditional, both branches N
   *   const p = (await P.first()) ?? new P()       a default, both operands P
   *   const u = auth.getUserOrFail()               the guard's model, per config/auth.ts
   *   const pasta = documento.pasta                a relation read off a loaded row
   *   for (const d of pasta.documentos)            a row of the relation's target
   *   rows.map(async (d) => …)                     the callback's parameter, a row
   *
   * Every one is a reading of what the code declares; none is a guess. A `save()`
   * on a local none of this can type is reported as unresolved — not dropped.
   */
  function bindLocals(
    body: Node,
    symbols: StoreSymbols,
    context: ResolverContext,
    strategies: CallResolver[]
  ): void {
    const returnedStoreOf = (
      call: CallExpression,
      from: ResolverContext = context,
      depth = 0
    ): string | null => {
      if (depth > 2) return null
      const resolved = resolveCall(call, from, strategies)
      if (!resolved || resolved.refs.length === 0) return null
      const found = new Set<string>()
      for (const target of resolved.refs) {
        const source = sourceFile(target.file)
        const resolvedBody = source ? findBody(source, target) : null
        if (!resolvedBody) continue
        const annotation = Node.isReturnTyped(resolvedBody)
          ? resolvedBody.getReturnTypeNode()?.getText()
          : undefined
        if (annotation) {
          const store = storeNamedBy(annotation, storesByName)
          if (store) found.add(store)
          else return null
          continue
        }
        // unannotated: every `return` a store access or `new Store()`, all the same store
        const own = storeSymbolsFor(resolvedBody, source!, app, storesByName, relationsByStore)
        const returns = resolvedBody
          .getDescendantsOfKind(SyntaxKind.ReturnStatement)
          .filter(
            (r) =>
              r.getFirstAncestor(
                (n) =>
                  Node.isMethodDeclaration(n) ||
                  Node.isFunctionDeclaration(n) ||
                  Node.isArrowFunction(n) ||
                  Node.isFunctionExpression(n)
              ) === resolvedBody
          )
        if (returns.length === 0) return null
        for (const statement of returns) {
          const value = statement.getExpression()
          if (!value) return null
          const unwrapped = unwrapAwait(value)
          if (unwrapped.getKind() === SyntaxKind.NullKeyword) continue
          // `return this.createFromBuffer(buffer)`: what THAT body returns, one level down
          if (Node.isCallExpression(unwrapped) && !detectAccess(unwrapped, own, relationsByStore)) {
            // resolved FROM the body that returns it: `this.createFromBuffer` is a method of that class
            const inner: ResolverContext = {
              ...context,
              file: source!,
              ...importsFor(source!),
              injected: injectedFor(
                resolvedBody.getFirstAncestorByKind(SyntaxKind.ClassDeclaration),
                source!,
                app
              ),
            }
            const store = returnedStoreOf(unwrapped, inner, depth + 1)
            if (!store) return null
            found.add(store)
            continue
          }
          const store = Node.isNewExpression(unwrapped)
            ? storesByName.has(unwrapped.getExpression().getText())
              ? unwrapped.getExpression().getText()
              : null
            : (own.get(rootSymbolOf(unwrapped) ?? '') ??
              (storesByName.has(rootSymbolOf(unwrapped) ?? '') ? rootSymbolOf(unwrapped) : null))
          if (!store) return null
          found.add(store)
        }
      }
      return found.size === 1 ? [...found][0] : null
    }

    const isAuthUser = (node: Node): boolean => {
      if (!authUserStore) return false
      const chain = Node.isCallExpression(node) ? node.getExpression() : node
      if (!Node.isPropertyAccessExpression(chain)) return false
      if (rootSymbolOf(chain) !== 'auth' && lastSegmentText(chain.getExpression()) !== 'auth')
        return false
      const last = chain.getName()
      return last === 'user' || last === 'getUserOrFail' || last === 'authenticate'
    }

    /** the store a value is rows (or one row) of, by what the code says — or nothing */
    const storeOfValue = (value: Node | undefined, depth = 0): string | null => {
      if (!value || depth > 6) return null
      const node = unwrapAwait(value)
      if (node.getKind() === SyntaxKind.NullKeyword) return null
      if (Node.isIdentifier(node)) {
        if (node.getText() === 'undefined') return null
        return symbols.get(node.getText()) ?? null
      }
      if (Node.isNewExpression(node)) {
        const name = node.getExpression().getText()
        return storesByName.has(name) ? name : null
      }
      if (Node.isConditionalExpression(node))
        return sameStore(
          storeOfValue(node.getWhenTrue(), depth + 1),
          storeOfValue(node.getWhenFalse(), depth + 1),
          node.getWhenTrue(),
          node.getWhenFalse()
        )
      if (Node.isBinaryExpression(node)) {
        const operator = node.getOperatorToken().getKind()
        if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken)
          return sameStore(
            storeOfValue(node.getLeft(), depth + 1),
            storeOfValue(node.getRight(), depth + 1),
            node.getLeft(),
            node.getRight()
          )
        return null
      }
      if (Node.isElementAccessExpression(node)) return storeOfValue(node.getExpression(), depth + 1)
      if (isAuthUser(node)) return authUserStore
      if (Node.isPropertyAccessExpression(node))
        return storeOfExpression(node, symbols, relationsByStore)
      if (Node.isCallExpression(node)) {
        const access = detectAccess(node, symbols, relationsByStore)
        if (access)
          return access.method === 'related' && access.viaRelation
            ? access.viaRelation
            : access.store
        const callee = node.getExpression()
        if (Node.isPropertyAccessExpression(callee) && ONE_OF_ROWS.has(callee.getName()))
          return storeOfValue(callee.getExpression(), depth + 1)
        return returnedStoreOf(node)
      }
      return null
    }

    const isNullish = (node: Node) => {
      const inner = unwrapAwait(node)
      return (
        inner.getKind() === SyntaxKind.NullKeyword ||
        (Node.isIdentifier(inner) && inner.getText() === 'undefined')
      )
    }
    const sameStore = (
      a: string | null,
      b: string | null,
      left: Node,
      right: Node
    ): string | null => {
      if (a && b) return a === b ? a : null
      if (a && isNullish(right)) return a
      if (b && isNullish(left)) return b
      return null
    }

    body.forEachDescendant((node) => {
      if (Node.isVariableDeclaration(node)) {
        const initializer = node.getInitializer()
        const nameNode = node.getNameNode()
        if (!initializer) return
        if (Node.isIdentifier(nameNode)) {
          if (symbols.has(nameNode.getText())) return
          const store = storeOfValue(initializer)
          if (store) symbols.set(nameNode.getText(), store)
        }
        return
      }
      if (Node.isForOfStatement(node)) {
        const declared = node.getInitializer()
        if (!Node.isVariableDeclarationList(declared)) return
        const nameNode = declared.getDeclarations()[0]?.getNameNode()
        if (!nameNode || !Node.isIdentifier(nameNode) || symbols.has(nameNode.getText())) return
        const store = storeOfValue(node.getExpression())
        if (store) symbols.set(nameNode.getText(), store)
        return
      }
      if (Node.isCallExpression(node)) {
        const callee = node.getExpression()
        if (!Node.isPropertyAccessExpression(callee) || !ITERATES_ROWS.has(callee.getName())) return
        const callback = node.getArguments()[0]
        if (!callback || !(Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)))
          return
        const parameter = callback.getParameters()[0]?.getNameNode()
        if (!parameter || !Node.isIdentifier(parameter) || symbols.has(parameter.getText())) return
        const store = storeOfValue(callee.getExpression())
        if (store) symbols.set(parameter.getText(), store)
      }
    })
  }

  function computeFacts(ref: HandlerRef): BodyFacts | null {
    const file = sourceFile(ref.file)
    if (!file) return null

    const body = findBody(file, ref)
    if (!body) return null

    const { imports, exportedAs } = importsFor(file)
    /** locals imported from packages, not from the application: their objects are not stores */
    const packageImports = new Set<string>()
    for (const declaration of file.getImportDeclarations()) {
      if (app.resolveSpecifier(declaration.getModuleSpecifierValue())) continue
      const defaultImport = declaration.getDefaultImport()?.getText()
      if (defaultImport) packageImports.add(defaultImport)
      for (const named of declaration.getNamedImports())
        packageImports.add(named.getAliasNode()?.getText() ?? named.getName())
    }
    /** the class this body belongs to: how `this.something` resolves */
    const owner = body.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)
    const injected = injectedFor(owner, file, app)
    const symbols = storeSymbolsFor(body, file, app, storesByName, relationsByStore)

    const accesses: { store: string; write: boolean; technical?: boolean }[] = []
    const followUps: { ref: HandlerRef; by: string; technical?: boolean }[] = []
    const unresolved: UnresolvedCall[] = []
    const reads: StoreRead[] = []
    /** calls a strategy claimed, and where they lead: a nested transformer's keys arrive through its body */
    const followedCalls = new Map<CallExpression, HandlerRef[]>()
    const validator = validatorFieldsIn(body, file, app)
    const commandFields = owner && isCommandClass(owner) ? commandFieldsOf(owner) : []
    const request = requestFieldsIn(body)

    const context: ResolverContext = {
      file,
      depth: 0,
      imports,
      exportedAs,
      injected,
      eventBindings,
      dataStoresBySymbol: storesByName,
      resolveSpecifier: app.resolveSpecifier,
      sourceFile,
    }

    bindLocals(body, symbols, context, resolvers)

    for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const access = detectAccess(call, symbols, relationsByStore)
      if (access) {
        /**
         * Asked about a DIRECT write too, not only about a call a resolver follows.
         *
         * `Notification.query().…update({ status: 'read' })` in a `show` handler is
         * exactly the shape this exists for, and the write IS the call — there is no
         * method to declare. Asking in one place only would have covered the service
         * call and missed the query builder beside it, which is the same fact written
         * differently.
         */
        const technical = access.mode === 'write' && isTechnicalWrite(call, context, resolvers)

        accesses.push({ store: access.store, write: access.mode === 'write', technical })

        /**
         * How the chain reads the store decides what leaves when nothing transforms
         * it — §6: rows whole, `.select()` columns, or one scalar from `.count()`.
         * A select list that is not literal is reported, and the store falls back
         * to every column, which overestimates in the open.
         *
         * `related('itens').query().count()` reads the RELATION target, and the
         * parent only as a receiver; `preload('itens')` reads the target whole.
         */
        if (access.mode === 'read') {
          const chain = chainShapeOf(call)
          const shape: StoreRead['shape'] = chain.aggregate
            ? 'aggregate'
            : chain.selected.length > 0
              ? 'select'
              : 'whole'
          /**
           * The select list survives an aggregate shape: `select('categoria').count()`
           * with a GROUP BY leaves the grouped column as well as the count. Dropping
           * it left a summary at 1 DET.
           */
          const read = (store: string, how: StoreRead['shape'], via?: string) =>
            reads.push({
              store,
              shape: how,
              columns: how === 'whole' ? [] : chain.selected,
              ...(via ? { via } : {}),
            })

          if (access.method === 'related' && access.viaRelation) {
            read(access.viaRelation, shape)
          } else {
            read(access.store, shape)
            if (access.viaRelation) read(access.viaRelation, 'whole', access.store)
          }

          for (const problem of chain.unreadable) {
            unresolved.push({
              file: ref.file,
              line: problem.line,
              expression: problem.expression,
              reason: `select with a column list that is not literal: ${access.store} counts every column`,
            })
          }
        }

        /**
         * A relation reached by `preload`/`load` is read; one written through
         * `related('files').create(…)` is written. Assuming read either way made
         * a table maintained only through a relation come out as an EIF.
         */
        if (access.viaRelation) {
          accesses.push({ store: access.viaRelation, write: access.relationWritten === true })
        }

        /**
         * counting-decisions §3: a hook belongs to the transaction that fired
         * it. It crosses no boundary — it fires inside one that already did —
         * so its accesses are this transaction's, and AFP §6.5.3 requires
         * aggregating every path reached.
         */
        for (const hook of hookRefsFor(access)) followUps.push({ ref: hook, by: 'model-hook' })
        continue
      }

      /**
       * Asked before the resolvers, unlike the rest of the noise filter: this
       * shape must not be CLAIMED, not merely not reported.
       */
      if (isIterationCall(call)) continue

      const resolved = resolveCall(call, context, resolvers)
      if (resolved) {
        /**
         * Declared about the CALL, so everything reached through it is incidental too:
         * `persistOrganizationVisit` is called from several screens and saying it once
         * covers all of them.
         */
        const technical = isTechnicalWrite(call, context, resolvers)
        for (const next of resolved.refs) followUps.push({ ref: next, by: resolved.by, technical })
        followedCalls.set(call, resolved.refs)
        continue
      }

      /**
       * `alvo.save()` on a receiver nobody could type. Not a write the count can
       * attribute — and not silence either: the reviewed application had six EIs
       * counted as EOs under a coverage of 99.5%, because a write on an unknown
       * local was dropped without a word. It lowers coverage and is named.
       */
      if (
        isUnreadableWrite(call, symbols, imports, packageImports, body) &&
        !isNoise(call, owner)
      ) {
        unresolved.push({
          file: ref.file,
          line: call.getStartLineNumber(),
          expression: call.getExpression().getText().replace(/\s+/g, ''),
          reason: 'write on a receiver whose type the analysis cannot read',
        })
        continue
      }

      if (isWorthReporting(call, symbols, imports) && !isNoise(call, owner)) {
        unresolved.push({
          file: ref.file,
          line: call.getStartLineNumber(),
          expression: call.getExpression().getText().replace(/\s+/g, ''),
          reason: 'call that no strategy knew how to follow',
        })
      }
    }

    /**
     * Read after the loop: whether a key holds a nested transformer is known only
     * once the strategies have said which calls they follow.
     */
    const followed = (c: CallExpression) => followedCalls.has(c)
    const output = outputFieldsIn(body, owner, storesByName, followed)
    const deliveries = deliveriesIn({
      body,
      file,
      symbols,
      relations: relationsByStore,
      followed: followedCalls,
    })

    return {
      accesses,
      followUps,
      unresolved,
      validators: validator.fields,
      commandFields,
      opaqueValidators: validator.opaque,
      requestFields: request.fields,
      opaqueRequest: request.opaque,
      outputs: output.outputs,
      opaqueOutputs: output.opaqueOutputs,
      transformed: output.resource,
      reads,
      deliveries,
      bodyHash: hashOf(body),
    }
  }

  /**
   * Stores written anywhere in the application's own code, reachable from an
   * entry point or not.
   *
   * AFP §6.5.4 decides ILF vs EIF by whether the APPLICATION maintains the
   * store. The graph only walks from HTTP routes, so a table written solely by a
   * job or a seeder looked unmaintained and came out as an EIF — data held by
   * another system. It is not: a job is this application. The misclassification
   * costs 2 points per store and, worse, says the wrong thing about who owns the
   * data.
   *
   * This is a separate pass because reachability is not the question. Whether a
   * transaction reaches the store still decides if it is counted at all; this
   * only decides who maintains it.
   */
  /**
   * Both project-wide facts come from one pass, computed once: which stores the
   * application WRITES (maintenance, §6.5.4) and which it ADDRESSES directly
   * (grouping, counting-decisions §10). A store reached only through a relation
   * — `preload('itens')`, `related('itens').create()` — is read or written, but
   * not addressed: the user never sees it outside its parent.
   */
  let projectWide: { written: Set<string>; addressed: Set<string>; seeded: Set<string> } | undefined

  const scanProject = () => {
    if (projectWide) return projectWide
    const written = new Set<string>()
    const addressed = new Set<string>()
    /** written by a seeder: not maintenance, but a fact the report needs (an EIF only a seed populates) */
    const seeded = new Set<string>()

    for (const file of project.getSourceFiles()) {
      /**
       * A seeder's inserts are not the application maintaining a table, and a test
       * factory's are not either. Counting them made every reference table an ILF:
       * the CPM puts data maintained by the development team at an EIF at most, and
       * code data outside the count entirely.
       *
       * This is the same notion `scanRoots` applies at the root, applied at any
       * depth — because a domain-module layout puts `tests/` and `seeders/` inside
       * `app/`, where the root filter never looks.
       */
      if (!isApplicationCode(app.root, file.getFilePath())) {
        if (isSeeder(app.root, file.getFilePath())) {
          const symbols = storeSymbolsFor(file, file, app, storesByName, relationsByStore)
          for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            const access = symbols.size > 0 ? detectAccess(call, symbols, relationsByStore) : null
            if (access?.mode !== 'write') continue
            seeded.add(access.store)
            if (access.viaRelation && access.relationWritten) seeded.add(access.viaRelation)
          }
        }
        continue
      }

      const symbols = storeSymbolsFor(file, file, app, storesByName, relationsByStore)
      if (symbols.size === 0) continue

      for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const access = detectAccess(call, symbols, relationsByStore)
        if (!access) continue

        // the root of the access is addressed; a relation target is only reached
        addressed.add(access.store)
        if (access.mode !== 'write') continue

        written.add(access.store)

        /**
         * `distribution.related('files').create(…)` maintains the related table.
         * Recording only the parent left a table written exclusively that way
         * looking like somebody else's — reported by a production application as
         * an EIF it was sure it maintained.
         */
        if (access.viaRelation && access.relationWritten) written.add(access.viaRelation)
      }

      // `new ItemPedido()` addresses the store as directly as `ItemPedido.create()` does
      for (const construction of file.getDescendantsOfKind(SyntaxKind.NewExpression)) {
        const target = construction.getExpression()
        const store = Node.isIdentifier(target) ? symbols.get(target.getText()) : undefined
        if (store) addressed.add(store)
      }
    }

    projectWide = { written, addressed, seeded }
    return projectWide
  }

  const writtenAnywhere = (): Set<string> => scanProject().written
  const addressedAnywhere = (): Set<string> => scanProject().addressed
  const seededAnywhere = (): Set<string> => scanProject().seeded

  return {
    analyze: (handler: HandlerRef) => run(handler),
    writtenAnywhere,
    addressedAnywhere,
    seededAnywhere,
    /** how many files the project loaded — used to prove it does not grow */
    fileCount: () => project.getSourceFiles().length,
  }

  function run(handler: HandlerRef): Behavior {
    const touches = new Set<string>()
    const writtenStores = new Set<string>()
    const inputFields = new Set<string>()
    const commandFields = new Set<string>()
    const opaqueInputFields = new Set<string>()
    const requestFields = new Set<string>()
    let opaqueRequest = false
    const outputFields = new Set<string>()
    const opaqueOutputFields = new Set<string>()
    const transformedStores = new Set<string>()
    const deliveredFields = new Set<string>()
    const deliveredOpaque = new Set<string>()
    const deliveredStores = new Set<string>()
    /** stores handed raw to a page: what the page shows of them is read after the walk */
    const rawDeliveries: RawDelivery[] = []
    let anyDelivery = false
    const outputReads = new Map<
      string,
      {
        whole: boolean
        selected: Set<string>
        aggregate: boolean
        direct: boolean
        via: Set<string>
      }
    >()
    const trace: TraceStep[] = []
    const scope: ScopeEntry[] = []
    const unresolved: UnresolvedCall[] = []
    const visited = new Set<string>()

    let writes = false

    /** what a followed body reads, itself and through what it follows — bounded like the walk */
    const storesReadBy = (
      ref: HandlerRef,
      depth: number,
      seen = new Set<string>()
    ): Set<string> => {
      const found = new Set<string>()
      const key = `${ref.file}#${ref.member ?? ref.line ?? '*'}`
      if (seen.has(key) || depth > maxDepth) return found
      seen.add(key)
      const facts = factsFor(ref)
      if (!facts) return found
      for (const access of facts.accesses) found.add(access.store)
      for (const followUp of facts.followUps) {
        for (const store of storesReadBy(followUp.ref, depth + 1, seen)) found.add(store)
      }
      return found
    }

    /**
     * A delivered call hands on what its body RETURNS — classified, so a returned
     * `{ data: rows, meta }` delivers the rows' store and the meta's leaves, not
     * one DET per key. `pick` keeps one key of it: `const { data } = …`,
     * `resultado.linhas`. Bounded by depth like the walk, and by a seen set so a
     * body returning itself cannot loop.
     */
    const deliver = (item: Delivery, depth: number, seen = new Set<string>()) => {
      switch (item.kind) {
        case 'store':
          deliveredStores.add(item.store)
          if (item.via) rawDeliveries.push({ ...item.via, store: item.store, path: item.path })
          return
        case 'scalar':
          deliveredFields.add(item.path || '<value>')
          return
        case 'echo':
          return
        case 'opaque':
          deliveredOpaque.add(`${item.path ? `${item.path}.` : ''}<${item.expression}>`)
          return
        case 'call': {
          if (depth > maxDepth + 2) return
          let resolved = false
          for (const ref of item.refs) {
            // the same body may be delivered at two paths (`...paraLinha(x)` and `relacionadas: xs.map(paraLinha)`); a cycle is stopped by depth
            const key = `${ref.file}#${ref.member ?? ref.line ?? '*'}#${item.pick ?? ''}#${item.path}`
            if (seen.has(key)) continue
            seen.add(key)
            const facts = factsFor(ref)
            if (!facts) continue
            // a transformer: its keys are the output already, through the body the graph follows
            if (facts.outputs.length > 0 || facts.transformed) {
              resolved = true
              continue
            }
            const returned = facts.deliveries.returns.filter(
              (r) => !item.pick || r.path === item.pick || r.path.startsWith(`${item.pick}.`)
            )
            /**
             * `egresso.curso` where the body returns the row itself (`return
             * Egresso.query()…first()`, path ''): the pick lands INSIDE a returned
             * value — one field of a store is one value; one key of a returned call
             * is that call picked deeper.
             */
            if (item.pick && returned.length === 0) {
              const above = facts.deliveries.returns.filter(
                (r) => r.path === '' || item.pick!.startsWith(`${r.path}.`)
              )
              for (const r of above) {
                const rest = r.path ? item.pick.slice(r.path.length + 1) : item.pick
                if (r.kind === 'call')
                  deliver({ ...r, path: item.path, pick: rest, via: item.via }, depth + 1, seen)
                else if (r.kind === 'store' || r.kind === 'scalar')
                  deliveredFields.add(item.path || '<value>')
              }
              if (above.length > 0) {
                resolved = true
                continue
              }
            }
            /**
             * A return the classifier could not read at all (`rows.map(…).join(…)`)
             * says nothing about what leaves; what the body read, or what was handed
             * into it, says more — so it does not count as resolved.
             */
            if (returned.length > 0 && returned.some((r) => r.kind !== 'opaque')) {
              for (const r of returned) {
                const rest = item.pick ? r.path.slice(item.pick.length).replace(/^\./, '') : r.path
                const path = [item.path, rest].filter(Boolean).join('.')
                deliver({ ...r, path, via: item.via } as Delivery, depth + 1, seen)
              }
              resolved = true
              continue
            }
            if (item.pick) continue
            const read = storesReadBy(ref, depth + 1)
            if (read.size > 0) {
              for (const store of read) {
                deliveredStores.add(store)
                if (item.via) rawDeliveries.push({ ...item.via, store, path: item.path })
              }
              resolved = true
            }
          }
          if (resolved) return
          /**
           * `const { confidenciais } = await this.contar()` where the body's return
           * is unreadable: one KEY of it, named — one value, not an opaque floor.
           * Only a key that carries rows on (`data`, `rows`) stays unreadable.
           */
          if (item.pick && !PASSES_ROWS.has(item.pick.split('.')[0])) {
            deliveredFields.add(item.path || '<value>')
            return
          }
          /**
           * The body returned no literal and read no store — a CSV builder, a
           * formatter over rows handed in. The document it built carries what it
           * received, so the rows' stores leave. Nothing handed in: opaque.
           */
          if (item.args.length > 0) {
            for (const argument of item.args) deliver({ ...argument, via: item.via }, depth, seen)
            return
          }
          deliveredOpaque.add(`${item.path ? `${item.path}.` : ''}<${item.expression}>`)
        }
      }
    }

    const visit = (ref: HandlerRef, depth: number, technical = false) => {
      const key = `${ref.file}#${ref.member ?? ref.line ?? '*'}`
      if (visited.has(key) || depth > maxDepth) return
      visited.add(key)

      const facts = factsFor(ref)
      if (!facts) {
        /**
         * The resolver got the file right, but the body is not there — an
         * inherited method from a package class, for example
         * (`Transformer.transform()` coming from `BaseTransformer`).
         *
         * Dropping it silently is the worst possible defect: the transaction
         * loses a path and nobody knows.
         */
        if (!isNoiseMember(ref.file, ref.member)) {
          unresolved.push({
            file: ref.file,
            line: ref.line ?? 0,
            expression: `${pathOf(ref.file)}.${ref.member ?? 'handle'}`,
            reason: 'body not found in the resolved file: probably inherited from a package class',
          })
        }
        return
      }

      let bodyWrites = false
      for (const access of facts.accesses) {
        touches.add(access.store)
        if (!access.write) continue

        /**
         * The store is maintained either way — a visit table really is written by this
         * application, so it stays an ILF and stays an FTR. What a technical write does
         * not do is decide what the transaction is FOR: §6.5.3 would read a `GET` that
         * notes the visit as an EI, and the CPM asks about primary intent.
         */
        writtenStores.add(access.store)
        bodyWrites = true
        if (!technical && !access.technical) writes = true
      }

      unresolved.push(...facts.unresolved)
      for (const field of facts.validators) inputFields.add(field)
      for (const field of facts.commandFields) commandFields.add(field)
      for (const field of facts.opaqueValidators) opaqueInputFields.add(field)
      for (const field of facts.requestFields) requestFields.add(field)
      if (facts.opaqueRequest) opaqueRequest = true
      for (const field of facts.outputs) outputFields.add(field)
      for (const field of facts.opaqueOutputs) opaqueOutputFields.add(field)
      if (facts.transformed) transformedStores.add(facts.transformed)
      /**
       * Deliveries, resolved here because a delivered CALL leads to a body only
       * the graph knows: what that body returns is what the value hands on.
       */
      const items: Delivery[] = [
        ...facts.deliveries.calls,
        ...(depth === 0 ? facts.deliveries.returns : []),
      ]
      if (facts.deliveries.anyCall || (depth === 0 && facts.deliveries.anyReturn))
        anyDelivery = true
      for (const item of items) deliver(item, depth)

      for (const { store, shape, columns, via } of facts.reads) {
        const known = outputReads.get(store) ?? {
          whole: false,
          selected: new Set<string>(),
          aggregate: false,
          direct: false,
          via: new Set<string>(),
        }
        if (shape === 'whole') known.whole = true
        if (shape === 'aggregate') known.aggregate = true
        for (const column of columns) known.selected.add(column)
        if (via) known.via.add(via)
        else known.direct = true
        outputReads.set(store, known)
      }

      trace.push({
        file: ref.file,
        member: ref.member,
        depth,
        by: ref.member ?? 'entry',
        writes: bodyWrites,
      })
      scope.push({ file: ref.file, member: ref.member, bodyHash: facts.bodyHash })

      if (depth >= maxDepth) return

      for (const followUp of facts.followUps) {
        const before = trace.length
        visit(followUp.ref, depth + 1, technical || followUp.technical === true)
        // record which strategy resolved the step that just entered the trace
        if (trace.length > before) trace[before].by = followUp.by
      }
    }

    visit(handler, 0)

    /**
     * What each page shows of the stores handed to it raw — read once the walk is
     * done, because a query object's rows reach the page through the delivery of a
     * call, not of a variable (plan 0.8 §D).
     */
    // a store a transformer covers is not raw: its keys are the output, whatever the page does with them
    const pages = readPages(
      rawDeliveries.filter((d) => !transformedStores.has(d.store)),
      {
        root: app.root,
        project,
        stores: storesByName,
        relations: relationsByStore,
        resolveSpecifier: app.resolveSpecifier,
      }
    )

    return {
      writes,
      touches: [...touches].sort(),
      writtenStores: [...writtenStores].sort(),
      inputFields: [...inputFields].sort(),
      commandFields: [...commandFields].sort(),
      opaqueInputFields: [...opaqueInputFields].sort(),
      requestFields: [...requestFields].sort(),
      opaqueRequest,
      outputFields: [...outputFields].sort(),
      opaqueOutputFields: [...opaqueOutputFields].sort(),
      transformedStores: [...transformedStores].sort(),
      delivered: {
        any: anyDelivery,
        fields: [...deliveredFields].sort(),
        opaqueFields: [...deliveredOpaque].sort(),
        stores: [...deliveredStores].sort(),
      },
      pageReads: Object.fromEntries(
        [...pages.columns.entries()].map(([store, columns]) => [store, [...columns].sort()])
      ),
      unreadablePages: Object.fromEntries(pages.unreadable),
      outputReads: Object.fromEntries(
        [...outputReads.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([store, read]) => [
            store,
            {
              whole: read.whole,
              selected: [...read.selected].sort(),
              aggregate: read.aggregate,
              direct: read.direct,
              via: [...read.via].sort(),
            },
          ])
      ),
      trace,
      scope,
      unresolved,
    }
  }
}

/** Convenience for a single handler; for several, use `createAnalyzer`. */
export function analyzeHandler(
  app: AppContext,
  stores: CollectedDataStore[],
  handler: HandlerRef,
  options: GraphOptions = {}
): Behavior {
  return createAnalyzer(app, stores, options).analyze(handler)
}

// ---------------------------------------------------------------------------
// body to analyse
// ---------------------------------------------------------------------------
/**
 * Resolves a `HandlerRef` to the corresponding body.
 *
 * Three forms coexist: a named method, a single-action handler (`handle`), and
 * an inline closure declared on the route itself — the last one located by
 * line, because it has no name.
 */
function findBody(file: SourceFile, ref: HandlerRef): Node | null {
  if (ref.line !== undefined) {
    const inline = file
      .getDescendants()
      .find(
        (node) =>
          (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) &&
          node.getStartLineNumber() === ref.line
      )
    if (inline) return inline
  }

  if (ref.member) {
    for (const cls of file.getClasses()) {
      const method = cls.getMethod(ref.member)
      if (method) return method
    }
    const fn = file.getFunction(ref.member)
    if (fn) return fn
    // `const paraLinha = (row) => …` at module level: a function by another declaration
    const initializer = file.getVariableDeclaration(ref.member)?.getInitializer()
    if (
      initializer &&
      (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    )
      return initializer
    return null
  }

  for (const cls of file.getClasses()) {
    const handle = cls.getMethod('handle')
    if (handle) return handle

    const publicMethods = cls.getMethods().filter((method) => !method.hasModifier('private'))
    if (publicMethods.length === 1) return publicMethods[0]
  }

  return null
}

// ---------------------------------------------------------------------------
// symbols that resolve to a data store
// ---------------------------------------------------------------------------
/**
 * Builds the symbol map valid INSIDE this body.
 *
 * It includes the models imported in the file and the local variables derived
 * from them: `const invite = await Invite.findOrFail(...)` makes `invite.save()`
 * count as a write to `Invite`.
 */
function storeSymbolsFor(
  body: Node,
  file: SourceFile,
  app: AppContext,
  stores: Map<string, CollectedDataStore>,
  relations: RelationMap = new Map()
): StoreSymbols {
  const symbols: StoreSymbols = new Map()

  for (const declaration of file.getImportDeclarations()) {
    const target = app.resolveSpecifier(declaration.getModuleSpecifierValue())
    if (!target) continue

    const local = declaration.getDefaultImport()?.getText()
    if (local && stores.has(local)) symbols.set(local, local)

    for (const named of declaration.getNamedImports()) {
      const binding = named.getAliasNode()?.getText() ?? named.getName()
      if (stores.has(named.getName())) symbols.set(binding, named.getName())
    }
  }

  /**
   * `const { default: Noticia } = await import('#noticias/models/noticia')`: a
   * model imported INSIDE the body — an ace command does this to keep the app
   * from booting for `--help`. The store is the same; only the binding moved.
   */
  const storeByFile = new Map<string, string>()
  for (const [name, store] of stores) storeByFile.set(toPosix(store.provenance.file), name)
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const binding = declaration.getNameNode()
    if (!Node.isObjectBindingPattern(binding)) continue
    let initializer = declaration.getInitializer()
    if (initializer && Node.isAwaitExpression(initializer))
      initializer = initializer.getExpression()
    if (!initializer || !Node.isCallExpression(initializer)) continue
    if (initializer.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue
    const specifier = initializer.getArguments()[0]
    if (!specifier || !Node.isStringLiteral(specifier)) continue
    const target = app.resolveSpecifier(specifier.getLiteralValue())
    const store = target ? storeByFile.get(toPosix(target)) : undefined
    if (!store) continue
    for (const element of binding.getElements()) {
      const property = element.getPropertyNameNode()?.getText() ?? element.getName()
      if (property === 'default') symbols.set(element.getName(), store)
    }
  }

  // local variables derived from an already known store
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer()
    const name = declaration.getNameNode()
    if (!Node.isIdentifier(name)) continue

    // `let message: Message | undefined`, assigned later: the declared type says what it holds
    const declared = storeNamedBy(declaration.getTypeNode()?.getText(), stores)
    if (declared) {
      symbols.set(name.getText(), declared)
      continue
    }
    if (!initializer) continue

    /**
     * `const pasta = documento.pasta`: a RELATION read off a row is the relation's
     * target, not the row's store — `pasta.save()` had been billed to `Documento`.
     * A plain field (`documento.nome`) is no store at all.
     */
    const plain = unwrapAwait(initializer)
    if (Node.isPropertyAccessExpression(plain)) {
      const target = storeOfExpression(plain, symbols, relations)
      if (target) symbols.set(name.getText(), target)
      continue
    }

    const root = rootSymbolOf(initializer)
    const store = root ? symbols.get(root) : undefined
    if (store) symbols.set(name.getText(), store)
  }

  // parameters carrying a store
  if (Node.isMethodDeclaration(body) || Node.isFunctionDeclaration(body)) {
    for (const parameter of body.getParameters()) {
      const typeNode = parameter.getTypeNode()
      const nameNode = parameter.getNameNode()

      // direct form: `expire(invite: Invite)`, `mark(attachments: Attachment[])`, `x: Invite | null`
      const typeName = storeNamedBy(typeNode?.getText(), stores)
      if (typeName && Node.isIdentifier(nameNode)) {
        symbols.set(nameNode.getText(), typeName)
        continue
      }

      /**
       * Named type: `handle(input: ExpireInviteInput)` with
       * `interface ExpireInviteInput { invite: Invite }`.
       *
       * Registers the PATH `input.invite`, because that is how the write
       * appears: `input.invite.save()`.
       */
      if (typeNode && Node.isIdentifier(nameNode)) {
        for (const [property, propertyType] of membersOfType(typeNode, file, app)) {
          const named = storeNamedBy(propertyType, stores)
          if (named) symbols.set(`${nameNode.getText()}.${property}`, named)
        }
      }

      /**
       * Destructured form: `handle({ invite }: { invite: Invite })`, and
       * `handle({ document, name }: RenameDocumentInput)` with the interface named
       * — in this file or imported. The second is the dominant shape on a reviewed
       * application, and only the inline literal was read: every `document.save()`
       * behind it was invisible, and the transaction an EO (plan 0.8 §A).
       */
      const binding = nameNode.asKind(SyntaxKind.ObjectBindingPattern)
      if (!binding || !typeNode) continue

      const propertyTypes = membersOfType(typeNode, file, app)
      for (const element of binding.getElements()) {
        const property = element.getPropertyNameNode()?.getText() ?? element.getName()
        const resolved = storeNamedBy(propertyTypes.get(property), stores)
        if (resolved) symbols.set(element.getName(), resolved)
      }
    }
  }

  /**
   * `const { preIntake } = input` where `input.preIntake` is a registered path:
   * each element inherits the store of its path. Read AFTER the parameters, which
   * is where the paths come from.
   */
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const binding = declaration.getNameNode()
    const initializer = declaration.getInitializer()
    if (!Node.isObjectBindingPattern(binding) || !initializer) continue
    const root = Node.isIdentifier(initializer) ? initializer.getText() : null
    if (!root) continue
    for (const element of binding.getElements()) {
      const property = element.getPropertyNameNode()?.getText() ?? element.getName()
      const store = symbols.get(`${root}.${property}`)
      if (store) symbols.set(element.getName(), store)
    }
  }

  /**
   * `for (const documento of pasta.documentos)`, `for (const row of rows)`: the
   * loop variable is a row of the relation's target, or of the rows' store. A
   * `delete()` inside such a loop was invisible; read last, after the parameters that name the parent — plan 0.8 §A.
   */
  for (const loop of body.getDescendantsOfKind(SyntaxKind.ForOfStatement)) {
    const declared = loop.getInitializer()
    if (!Node.isVariableDeclarationList(declared)) continue
    const nameNode = declared.getDeclarations()[0]?.getNameNode()
    if (!nameNode || !Node.isIdentifier(nameNode)) continue
    const store = storeOfExpression(unwrapAwait(loop.getExpression()), symbols, relations)
    if (store) symbols.set(nameNode.getText(), store)
  }

  return symbols
}

/**
 * Injected dependencies visible in the body: property name -> file.
 *
 * Two forms, both with the type annotated explicitly — `@inject()` does not
 * work without it:
 *
 *   constructor(protected billing: BillingService) {}
 *   private declare billing: BillingService
 *
 * Since the type is an imported identifier, it resolves through the same path
 * as any import. No type checker is needed.
 */
export function injectedFor(
  owner: ClassDeclaration | undefined,
  file: SourceFile,
  app: AppContext
): Map<string, string> {
  const injected = new Map<string, string>()
  if (!owner) return injected

  const register = (property: string, typeName: string | undefined) => {
    if (!typeName) return
    const target = resolveTypeToFile(typeName, file, app)
    if (target) injected.set(property, target)
  }

  for (const parameter of owner.getConstructors()[0]?.getParameters() ?? []) {
    register(parameter.getName(), dependencyTypeOf(parameter))
  }

  for (const property of owner.getProperties()) {
    register(property.getName(), dependencyTypeOf(property))
  }

  return injected
}

/**
 * The declared type of a dependency, or the class its default value builds.
 *
 *     constructor(private invites: InviteService) {}        annotation
 *     constructor(private invites = new InviteService()) {} default value
 *
 * The second is injection without the container, and it carries no type
 * annotation at all — the type is inferred from the initialiser. Reading only
 * `getTypeNode()` saw nothing there, and the consequence was not a gap in
 * coverage but a wrong classification: the write inside the service stayed
 * invisible, so the transaction counted as an EO instead of an EI.
 */
function dependencyTypeOf(node: ParameterDeclaration | PropertyDeclaration): string | undefined {
  const declared = node.getTypeNode()?.getText()
  if (declared) return declared

  const initializer = node.getInitializer()
  if (initializer && Node.isNewExpression(initializer)) {
    const target = initializer.getExpression()
    if (Node.isIdentifier(target)) return target.getText()
  }

  return undefined
}

/** type identifier -> application file where it is declared */
function resolveTypeToFile(typeName: string, file: SourceFile, app: AppContext): string | null {
  const bare = typeName.replace(/<.*/, '').trim()

  for (const declaration of file.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue()

    if (declaration.getDefaultImport()?.getText() === bare) {
      return app.resolveSpecifier(specifier)
    }
    for (const named of declaration.getNamedImports()) {
      const binding = named.getAliasNode()?.getText() ?? named.getName()
      if (binding === bare) return app.resolveSpecifier(specifier)
    }
  }

  return null
}

/**
 * Members of a declared type: `interface X { a: A }` -> { a: 'A' }.
 *
 * Accepts an inline type literal and a named type declared in this file or
 * imported from the application. Anything else yields empty — no guessing.
 */
/**
 * The store a type annotation names, or nothing: `Sessao`, `Sessao | null`,
 * `Promise<Sessao | null>`, `Sessao[]`, `Promise<Sessao[]>`. Two different stores
 * in one union name nothing — a guess is not a binding.
 */
function storeNamedBy(
  typeText: string | undefined,
  stores: Map<string, CollectedDataStore>
): string | null {
  if (!typeText) return null
  let text = typeText.trim()
  const promise = text.match(/^Promise<([\s\S]*)>$/)
  if (promise) text = promise[1]
  const named = new Set(
    text
      .split('|')
      .map((part) =>
        part
          .trim()
          .replace(/\[\]$/, '')
          .replace(/^Array<(.*)>$/, '$1')
          .trim()
      )
      .filter((part) => part && part !== 'null' && part !== 'undefined')
  )
  if (named.size !== 1) return null
  const [only] = named
  return stores.has(only) ? only : null
}

/** array methods that hand back one row, or the same rows, of the receiver */
const ONE_OF_ROWS = new Set([
  'find',
  'findLast',
  'at',
  'filter',
  'slice',
  'sort',
  'toSorted',
  'reverse',
  'toReversed',
  'concat',
  'flat',
  'first',
  'last',
])
/** array methods whose callback receives one row of the receiver */
const ITERATES_ROWS = new Set([
  'map',
  'forEach',
  'filter',
  'find',
  'findLast',
  'some',
  'every',
  'flatMap',
  'reduce',
])

const lastSegmentText = (node: Node): string =>
  Node.isPropertyAccessExpression(node) ? node.getName() : node.getText()

/** the store an expression is rows of: a store symbol, or `parent.relation` with the relation declared */
function storeOfExpression(
  expression: Node | undefined,
  symbols: StoreSymbols,
  relations: RelationMap
): string | null {
  if (!expression) return null
  if (Node.isIdentifier(expression)) return symbols.get(expression.getText()) ?? null
  if (Node.isPropertyAccessExpression(expression)) {
    const receiver = expression.getExpression()
    // `input.documents`: a registered PATH of a typed parameter
    if (Node.isIdentifier(receiver)) {
      const byPath = symbols.get(`${receiver.getText()}.${expression.getName()}`)
      if (byPath) return byPath
    }
    const parent = symbols.get(rootSymbolOf(receiver) ?? '')
    if (!parent) return null
    return relations.get(parent)?.[expression.getName()] ?? null
  }
  const root = rootSymbolOf(expression)
  return root ? (symbols.get(root) ?? null) : null
}

function membersOfType(typeNode: Node, file: SourceFile, app: AppContext): Map<string, string> {
  const members = new Map<string, string>()

  const collect = (node: Node) => {
    const holders = Node.isTypeLiteral(node)
      ? node.getMembers()
      : Node.isInterfaceDeclaration(node)
        ? node.getMembers()
        : []

    for (const member of holders) {
      if (!Node.isPropertySignature(member)) continue
      const memberType = member.getTypeNode()?.getText()
      if (memberType) members.set(member.getName(), memberType)
    }
  }

  if (Node.isTypeLiteral(typeNode)) {
    collect(typeNode)
    return members
  }

  if (!Node.isTypeReference(typeNode)) return members
  const name = typeNode.getTypeName().getText()

  const local = file.getInterface(name) ?? file.getTypeAlias(name)
  if (local) {
    collect(Node.isTypeAliasDeclaration(local) ? (local.getTypeNode() ?? local) : local)
    return members
  }

  for (const declaration of file.getImportDeclarations()) {
    const target = app.resolveSpecifier(declaration.getModuleSpecifierValue())
    if (!target) continue

    const names = declaration.getNamedImports().map((named) => named.getName())
    if (!names.includes(name)) continue

    const source = file.getProject().addSourceFileAtPathIfExists(target)
    const declared = source?.getInterface(name) ?? source?.getTypeAlias(name)
    if (declared) {
      collect(
        Node.isTypeAliasDeclaration(declared) ? (declared.getTypeNode() ?? declared) : declared
      )
    }
  }

  return members
}

/**
 * Both maps a file's imports produce: where a local name resolves, and what it
 * was called where it was exported.
 *
 * Exported because the tests need the same answer the pipeline gets: a second
 * implementation in the helpers drifted from this one and missed aliases.
 */
export function importMapsOf(
  file: SourceFile,
  app: AppContext
): { imports: Map<string, string>; exportedAs: Map<string, string> } {
  const imports = new Map<string, string>()
  const exportedAs = new Map<string, string>()

  for (const declaration of file.getImportDeclarations()) {
    const target = app.resolveSpecifier(declaration.getModuleSpecifierValue())
    if (!target) continue

    const defaultImport = declaration.getDefaultImport()?.getText()
    if (defaultImport) imports.set(defaultImport, target)

    for (const named of declaration.getNamedImports()) {
      const alias = named.getAliasNode()?.getText()
      const local = alias ?? named.getName()
      imports.set(local, target)
      if (alias) exportedAs.set(alias, named.getName())
    }
  }

  /**
   * `const { default: SincronizarBulk } = await import('#inpi/actions/sincronizar_bulk')`
   * `const { execucaoEmAndamento } = await import('#inpi/services/execucao')`
   *
   * A module imported INSIDE a body — the shape ace commands use so `--help` does
   * not boot the application. The binding moved; the body it names did not, and
   * a command importing its whole action layer this way reached nothing.
   */
  for (const declaration of file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const binding = declaration.getNameNode()
    if (!Node.isObjectBindingPattern(binding)) continue
    let initializer = declaration.getInitializer()
    if (initializer && Node.isAwaitExpression(initializer))
      initializer = initializer.getExpression()
    if (!initializer || !Node.isCallExpression(initializer)) continue
    if (initializer.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue
    const specifier = initializer.getArguments()[0]
    if (!specifier || !Node.isStringLiteral(specifier)) continue
    const target = app.resolveSpecifier(specifier.getLiteralValue())
    if (!target) continue

    for (const element of binding.getElements()) {
      const exported = element.getPropertyNameNode()?.getText() ?? element.getName()
      const local = element.getName()
      imports.set(local, target)
      if (exported !== 'default' && exported !== local) exportedAs.set(local, exported)
    }
  }

  return { imports, exportedAs }
}

// ---------------------------------------------------------------------------
// noise vs unresolved
// ---------------------------------------------------------------------------
/**
 * Not every unfollowed call is an unresolved call — but the filter must err on
 * the side of reporting.
 *
 * `response.redirect()` and `inertia.render()` lead to no data at all and would
 * only drown the report. But a call on a symbol imported from the APPLICATION
 * itself may hide a data access, and silencing it is the worst possible defect
 * here: the transaction becomes an EO and nobody knows.
 *
 * A filter that only reported `this.` would hide most of the real gap.
 */
function isWorthReporting(
  call: CallExpression,
  symbols: StoreSymbols,
  imports: Map<string, string>
): boolean {
  const expression = call.getExpression()

  // module function imported from the application: `expireInvite(...)`
  if (Node.isIdentifier(expression)) return imports.has(expression.getText())

  if (!Node.isPropertyAccessExpression(expression)) return false

  /**
   * A call ON THE RESULT of another call — `dispatch(job).waitResult()`,
   * `load(id).unwrap()`. The receiver is a value this body already holds, and
   * the call that produced it is a call site of this same body: it is visited
   * too, and reports the gap if there is one. Reporting here as well charges
   * the same unknown twice, and the second charge reads as a distinct defect.
   */
  const receiver = unwrapAwait(expression.getExpression())
  if (Node.isCallExpression(receiver)) return false

  const root = rootSymbolOf(expression.getExpression())
  if (!root) return false

  // already accounted for as a data access
  if (symbols.has(root)) return false

  // `this.something()` may be an injected dependency — a known gap
  if (root === 'this') return true

  // a symbol of the application itself that no strategy followed
  return imports.has(root)
}

/** Lucid's persistence on an instance, with no arguments: `x.save()`, `x.delete()` — a `Map#delete(key)` has one */
const INSTANCE_WRITES = new Set(['save', 'delete', 'forceDelete'])
/** persistence through a relation or a merge: `x.related('y').create(…)`, `x.merge(p).save()` */
const CHAINED_WRITES = new Set([
  'create',
  'createMany',
  'save',
  'saveMany',
  'attach',
  'detach',
  'sync',
  'updateOrCreate',
  'firstOrCreate',
  'delete',
])
const WRITE_CHAINS = new Set(['related', 'merge', 'fill', 'useTransaction'])

/**
 * A persistence call on a receiver the body cannot type: a local that is neither a
 * store, nor an import, nor `this`, nor the result of a call on one of those.
 * Reported as unresolved — the count must not stay silent where an EI may hide.
 */
function isUnreadableWrite(
  call: CallExpression,
  symbols: StoreSymbols,
  imports: Map<string, string>,
  packageImports: Set<string>,
  body: Node
): boolean {
  const expression = call.getExpression()
  if (!Node.isPropertyAccessExpression(expression)) return false
  const method = expression.getName()
  const receiver = unwrapAwait(expression.getExpression())

  if (Node.isCallExpression(receiver)) {
    const inner = receiver.getExpression()
    if (!Node.isPropertyAccessExpression(inner) || !WRITE_CHAINS.has(inner.getName())) return false
    if (!CHAINED_WRITES.has(method)) return false
  } else {
    if (!INSTANCE_WRITES.has(method) || call.getArguments().length > 0) return false
  }

  const root = rootSymbolOf(expression.getExpression())
  if (!root || root === 'this') return false
  if (symbols.has(root) || imports.has(root) || packageImports.has(root)) return false
  if (!Node.isIdentifier(unwrapAwait(rootNodeOf(expression.getExpression())))) return false

  /**
   * `const pdfDoc = await PDFDocument.create()` from `pdf-lib`, then `pdfDoc.save()`:
   * a package's object with a method called `save`. Its declaration says where it
   * came from, and it is not a store — nothing to report.
   */
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = declaration.getNameNode()
    if (!Node.isIdentifier(nameNode) || nameNode.getText() !== root) continue
    const initializer = declaration.getInitializer()
    const origin = initializer ? rootSymbolOf(unwrapAwait(initializer)) : null
    if (origin && packageImports.has(origin)) return false
  }
  return true
}

/** the leftmost node of a chain */
function rootNodeOf(node: Node): Node {
  let current: Node = node
  for (let depth = 0; depth < 40; depth++) {
    const next = unwrapAwait(current)
    if (
      Node.isPropertyAccessExpression(next) ||
      Node.isCallExpression(next) ||
      Node.isElementAccessExpression(next)
    ) {
      current = next.getExpression()
      continue
    }
    return next
  }
  return current
}

/** `(await x())` and `x()` are the same receiver for this purpose. */
function unwrapAwait(node: Node): Node {
  let current = node
  while (
    Node.isAwaitExpression(current) ||
    Node.isParenthesizedExpression(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression()
  }
  return current
}

// ---------------------------------------------------------------------------
// scope hash
// ---------------------------------------------------------------------------
/**
 * Hash of the NORMALISED body: comments and whitespace removed.
 *
 * counting-decisions §5 measures modification by a checksum of the
 * implementation scope. If the hash were over the raw bytes, running Prettier
 * would turn into an invoice.
 */
function hashOf(body: Node): string {
  const normalized = body
    .getText()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, '')

  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}
