import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

/**
 * Recognises Lucid data access at a call site.
 *
 * **Call-site level, never file level.** A large domain service can hold dozens
 * of writes; asking "does this file contain a write?" would mark every importer
 * as a writer.
 *
 * False positives deliberately avoided here:
 *
 *   `.related('x')`   a relation accessor, used both to read and to write — it
 *                     only counts when it ends in attach/detach/sync/save/create
 *   `.create(`        also appears in `vine.create(` and various builders; it
 *                     only counts when the receiver resolves to a known store
 *   `invite.save()`   a lower-case instance does not match the model name under
 *                     textual comparison — hence the symbol map
 */

export type AccessMode = 'read' | 'write'

export type PersistenceAccess = {
  mode: AccessMode
  /** id of the data store reached */
  store: string
  method: string
  line: number
  /**
   * Store reached through a RELATION rather than directly.
   *
   * `Book.query().preload('author')` reads the authors table. Under AFP that is
   * an FTR on `Author`, and ignoring it would drop a table read only through a
   * relation out of the count (§6.5.4) when it is a legitimate EIF.
   */
  viaRelation?: string
  /**
   * Does this access fire the model's hooks?
   *
   * Lucid fires instance hooks for `document.delete()` and does NOT fire them
   * for `Document.query().where(…).delete()` — both of which land on
   * `method === 'delete'`. Following hooks for the bulk form would invent an
   * FTR, and counting more than is there is worse than counting less: an
   * invented FTR moves a complexity band and goes onto an invoice.
   */
  firesHooks: boolean
}

const WRITE_METHODS = new Set([
  'save',
  'delete',
  'create',
  'createMany',
  'merge',
  'fill',
  'updateOrCreate',
  'fetchOrCreateMany',
  'firstOrCreate',
  'updateOrCreateMany',
  'attach',
  'detach',
  'sync',
  'increment',
  'decrement',
  'update',
  'truncate',
  'restore',
  'forceDelete',
])

/**
 * Which hooks each access fires, by decorator name — counting-decisions §3.
 *
 * `save()` fires the save pair AND the create-or-update pair, and which of the
 * two runs is not knowable statically. That is not a compromise here: AFP
 * §6.5.3 requires treating multiple optional paths as part of the same
 * transaction, so following both is the specified behaviour.
 */
const HOOKS_BY_METHOD: Record<string, string[]> = {
  save: ['beforeSave', 'afterSave', 'beforeCreate', 'afterCreate', 'beforeUpdate', 'afterUpdate'],
  create: ['beforeCreate', 'afterCreate', 'beforeSave', 'afterSave'],
  createMany: ['beforeCreate', 'afterCreate', 'beforeSave', 'afterSave'],
  firstOrCreate: ['beforeCreate', 'afterCreate', 'beforeSave', 'afterSave'],
  fetchOrCreateMany: ['beforeCreate', 'afterCreate', 'beforeSave', 'afterSave'],
  updateOrCreate: [
    'beforeCreate',
    'afterCreate',
    'beforeUpdate',
    'afterUpdate',
    'beforeSave',
    'afterSave',
  ],
  updateOrCreateMany: [
    'beforeCreate',
    'afterCreate',
    'beforeUpdate',
    'afterUpdate',
    'beforeSave',
    'afterSave',
  ],
  delete: ['beforeDelete', 'afterDelete'],
  forceDelete: ['beforeDelete', 'afterDelete'],
  find: ['beforeFind', 'afterFind'],
  findOrFail: ['beforeFind', 'afterFind'],
  findBy: ['beforeFind', 'afterFind'],
  findByOrFail: ['beforeFind', 'afterFind'],
  first: ['beforeFind', 'afterFind'],
  firstOrFail: ['beforeFind', 'afterFind'],
  all: ['beforeFetch', 'afterFetch'],
  findMany: ['beforeFetch', 'afterFetch'],
}

/** decorators this package knows how to follow */
export const HOOK_DECORATORS = new Set(Object.values(HOOKS_BY_METHOD).flat())

/**
 * Hook decorators fired by an access, or `[]` when it fires none.
 *
 * `truncate`, `increment`, `decrement` and the pivot operations change rows
 * without instantiating a model, so no hook runs.
 */
export function hooksFiredBy(access: PersistenceAccess): string[] {
  if (!access.firesHooks) return []
  return HOOKS_BY_METHOD[access.method] ?? []
}

const READ_METHODS = new Set([
  'find',
  'findOrFail',
  'findBy',
  'findByOrFail',
  'findMany',
  'first',
  'firstOrFail',
  'all',
  'query',
  'preload',
  'load',
  'paginate',
  'count',
  'exists',
  'related',
  'where',
  'orderBy',
])

/**
 * Symbols that resolve to a data store within a body's scope.
 *
 * Includes the model name (`Invite`) and local variables derived from it
 * (`const invite = await Invite.findOrFail(...)`).
 */
export type StoreSymbols = Map<string, string>

/** store -> its declared relations */
export type RelationMap = Map<string, Record<string, string>>

export function detectAccess(
  call: CallExpression,
  symbols: StoreSymbols,
  relations: RelationMap = new Map()
): PersistenceAccess | null {
  const expression = call.getExpression()
  if (!Node.isPropertyAccessExpression(expression)) return null

  const method = expression.getName()
  const isWrite = WRITE_METHODS.has(method)
  if (!isWrite && !READ_METHODS.has(method)) return null

  const receiver = expression.getExpression()

  /**
   * Looks up the PATH before the root: `input.invite.save()` has root `input`,
   * which is no store at all — `input.invite` is.
   *
   * This is the dominant shape in action objects with a typed input, and
   * without it the graph reaches the action and sees no write.
   */
  const store =
    symbols.get(pathSymbolOf(receiver) ?? '') ?? symbols.get(rootSymbolOf(receiver) ?? '')
  if (!store) return null

  return {
    mode: isWrite ? 'write' : 'read',
    store,
    method,
    line: call.getStartLineNumber(),
    viaRelation: relationTargetOf(method, call, store, relations),
    firesHooks: firesHooks(receiver),
  }
}

/**
 * An access fires hooks unless it went through the query builder.
 *
 * The signal is a CALL anywhere in the receiver chain: `document.delete()` has
 * none, `Document.query().where(…).delete()` has two. It errs towards NOT
 * following — `(await Document.find(id))!.delete()` is read as bulk — because
 * an FTR that is missing understates, and one that is invented overstates.
 */
function firesHooks(receiver: Node): boolean {
  let current: Node = receiver

  for (let depth = 0; depth < 20; depth++) {
    if (Node.isCallExpression(current)) return false
    if (!Node.isPropertyAccessExpression(current)) return Node.isIdentifier(current)
    current = current.getExpression()
  }

  return false
}

const RELATION_ACCESSORS = new Set(['preload', 'load', 'related', 'withCount'])

/**
 * `.preload('author')` on a store declaring `{ author: 'Author' }` reaches
 * `Author`.
 */
function relationTargetOf(
  method: string,
  call: CallExpression,
  store: string,
  relations: RelationMap
): string | undefined {
  if (!RELATION_ACCESSORS.has(method)) return undefined

  const name = call.getArguments()[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
  if (!name) return undefined

  return relations.get(store)?.[name]
}

/**
 * Dotted path of a receiver made only of property accesses: `input.invite`
 * yields "input.invite". Any call in between invalidates the path, because the
 * value stops being statically traceable.
 */
export function pathSymbolOf(node: Node): string | null {
  const parts: string[] = []
  let current: Node = node

  for (let depth = 0; depth < 20; depth++) {
    if (Node.isIdentifier(current)) return [current.getText(), ...parts].join('.')
    if (!Node.isPropertyAccessExpression(current)) return null

    parts.unshift(current.getName())
    current = current.getExpression()
  }

  return null
}

/**
 * Root of an `a.b().c()` chain — the left-most identifier.
 *
 * It must traverse `await`, calls, property access and `new`, otherwise
 * `await new Action().handle()` and `Invite.query().where().update()` stop at
 * the first node and the write disappears.
 */
export function rootSymbolOf(node: Node): string | null {
  let current: Node | undefined = node

  for (let depth = 0; depth < 60 && current; depth++) {
    if (Node.isIdentifier(current)) return current.getText()
    if (current.getKind() === SyntaxKind.ThisKeyword) return 'this'

    if (
      Node.isPropertyAccessExpression(current) ||
      Node.isElementAccessExpression(current) ||
      Node.isCallExpression(current) ||
      Node.isNewExpression(current) ||
      Node.isAwaitExpression(current) ||
      Node.isParenthesizedExpression(current) ||
      Node.isNonNullExpression(current)
    ) {
      current = current.getExpression()
      continue
    }

    return null
  }

  return null
}
