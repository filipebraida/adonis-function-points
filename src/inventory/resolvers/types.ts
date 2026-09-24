import type { CallExpression, Node, SourceFile } from 'ts-morph'

import type { DataStore, EntryPoint, HandlerRef, Provenance } from '../../types.js'

/**
 * AdonisJS does not impose a code organisation. The same transaction can be
 * written in very different ways:
 *
 *   fat controller      await User.create(payload)
 *   action object       await new CreateUser().handle(payload)
 *   static service      await UserService.create(payload)
 *   injected service    await this.users.create(payload)
 *   repository          await this.repo.persist(user)
 *   job                 await CreateUserJob.dispatch(payload)
 *   query builder       await db.table('users').insert(payload)
 *
 * No closed list covers that. Tracing is therefore assembled from registrable
 * strategies, and whatever none of them resolves is REPORTED — never silently
 * treated as a read.
 *
 * That is the most important contract in the package: saying "I don't know" is
 * preferable to producing a number that looks right.
 */

export type ResolverContext = {
  /** file containing the call site */
  file: SourceFile
  /** current depth in the call graph */
  depth: number
  /** file imports: local identifier -> resolved absolute path */
  imports: Map<string, string>
  /**
   * Injected dependencies visible in this body: property name -> class file.
   * For example `billing` -> `.../billing_service.ts`.
   *
   * No type checker needed: AdonisJS `@inject()` **requires** an explicit type
   * annotation for the container to resolve the dependency, so
   * `constructor(protected billing: BillingService)` always carries the
   * type as an identifier — imported like any other.
   */
  injected: Map<string, string>
  /**
   * Known data stores, keyed by symbol name (e.g. 'User').
   *
   * ORDERING INVARIANT: data stores are collected BEFORE any handler analysis.
   * Without that, `UserService.create()` and `User.create()` are
   * indistinguishable by shape, and a resolver would walk into the model as if
   * it were business code.
   */
  dataStoresBySymbol: Map<string, DataStore>
  /** resolves an AdonisJS specifier (`#collect/models/invite`) to a path */
  resolveSpecifier(specifier: string): string | null
  /** loads a file into the project, if it exists */
  sourceFile(absPath: string): SourceFile | null
}

/**
 * Follows a call site to the next body to analyse.
 *
 * Returns `[]` when the strategy does not recognise the call — that is not an
 * error, another strategy may recognise it. Only when none does should the call
 * land in `unresolved`.
 */
export interface CallResolver {
  readonly name: string
  /** lower runs first; specific strategies before generic ones */
  readonly order?: number
  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[]
}

/**
 * Decides whether a call site touches a data store, and how.
 *
 * Deliberately separate from `CallResolver`: swapping the ORM changes the
 * detector, not the call graph.
 */
export interface PersistenceDetector {
  readonly name: string
  readonly order?: number
  detect(call: CallExpression, ctx: ResolverContext): PersistenceAccess | null
}

export type PersistenceAccess = {
  mode: 'read' | 'write'
  /** data store id, when identifiable */
  store?: string
  /** symbol used in the code, for diagnostics when `store` is unknown */
  symbol?: string
  provenance: Provenance
}

/**
 * Where logical data stores come from (ILF/EIF candidates).
 *
 * Default: Lucid models plus the generated schema. Another source (Prisma, raw
 * SQL schema) plugs in as another collector.
 */
export interface DataStoreCollector {
  readonly name: string
  collect(ctx: CollectorContext): Promise<DataStore[]> | DataStore[]
}

/**
 * Where entry points come from (EI/EO/EQ candidates).
 *
 * A transaction is not a synonym for an HTTP route: an ace command that imports
 * a spreadsheet, or a scheduled job that syncs with an external system, are
 * transactional functions under IFPUG. Each is a collector.
 */
export interface EntryPointCollector {
  readonly name: string
  collect(ctx: CollectorContext): Promise<EntryPoint[]> | EntryPoint[]
}

export type CollectorContext = {
  /** root of the analysed application */
  appRoot: string
  sourceFiles(glob: string): SourceFile[]
  sourceFile(absPath: string): SourceFile | null
  resolveSpecifier(specifier: string): string | null
  /** node -> {file, line}, for provenance */
  provenanceOf(node: Node, by: string): Provenance
}

export type ResolverRegistry = {
  callResolvers: CallResolver[]
  persistenceDetectors: PersistenceDetector[]
  dataStoreCollectors: DataStoreCollector[]
  entryPointCollectors: EntryPointCollector[]
}
