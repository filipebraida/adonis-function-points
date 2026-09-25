import type { CallExpression, SourceFile } from 'ts-morph'

import type { DataStore, HandlerRef } from '../../types.js'
import type { EventBindings } from '../sources/event_bindings.js'

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
   * Local identifier -> the name it was exported under, when they differ.
   *
   * `import { createUser as create }` binds `create` locally while the function
   * is `createUser` in its own file. Following the local name looks for a body
   * that does not exist, and the call is reported as unresolved for a reason
   * that is not true. Identity is the (specifier, exported name) pair — the same
   * mistake the data-store collector had to unlearn.
   */
  exportedAs: Map<string, string>
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
  /**
   * Which listeners each event reaches, read from `emitter.on(...)`.
   *
   * Empty when the application declares no bindings. Like the data stores, this
   * is collected BEFORE any handler analysis: a dispatch cannot be followed
   * from the call site alone, because the binding lives in a preload file the
   * handler never imports.
   */
  eventBindings: EventBindings
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

  /**
   * "This call is mine, and it reaches no data store."
   *
   * `resolve` has two outcomes where three are needed. Returning `[]` means
   * *not recognised*, so a strategy that recognises a call perfectly well and
   * knows it touches nothing countable had no way to say so: the call still
   * landed in `unresolved`, and a project could not answer its own false
   * positives without making the tool claim a body that does not exist.
   *
   * Declaring it here is deliberately louder than a name on a silence list.
   * It costs a named strategy and a reason in the project's own config, and
   * `fp:count` still reports the volume — because a silent drop is the worst
   * defect this package can have, whoever writes it.
   */
  ignores?(call: CallExpression, ctx: ResolverContext): boolean

  /**
   * "This call writes, and the write is not what the transaction is FOR."
   *
   * AFP §6.5.3 decides EI against EO mechanically: a transaction that modifies a data
   * store is an EI. That is deliberate — repeatability over CPM fidelity — and it
   * misreads one shape: a screen that records a visit, a last-seen organisation, a
   * view counter. The CPM asks what the elementary process is PRIMARILY for, and for a
   * `GET` that shows a record while noting the visit, the answer is presentation.
   *
   * So the fact is declared about the CALL, not about each transaction that reaches it:
   * `persistOrganizationVisit` is called from several screens and saying it once covers
   * all of them.
   *
   * It does NOT hide the write. The store is still maintained by this application —
   * still an ILF, still an FTR of the transaction — and only the transaction's
   * classification changes. A resolver that wanted the write to disappear would use
   * `ignores`, and would be wrong to.
   */
  technicalWrite?(call: CallExpression, ctx: ResolverContext): boolean
}
