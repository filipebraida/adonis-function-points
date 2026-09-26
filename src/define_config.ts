import type { ComplexityTable } from './albrecht/tables.js'
import type { ChangeFactors, ChangeReasonFactors } from './albrecht/diff.js'
import type { TechnicalPattern } from './albrecht/technical_filter.js'
import type { OpaqueDeclaration } from './albrecht/opaque.js'
import type { CallResolver } from './inventory/resolvers/types.js'
import type { Complexity, FunctionType } from './types.js'

/**
 * Package configuration.
 *
 * **Every option here has an effect, and a test proving it.** Configuration the
 * code does not honour is worse than no configuration at all: whoever sets it
 * believes something changed when nothing did, and the number goes into an
 * invoice.
 *
 * That is why the list is short. What remains configurable is what is a
 * **business decision** that no heuristic should make — the application
 * boundary, what is maintained externally, the calibrated complexity bands.
 * The rest the package discovers.
 */
export type FunctionPointsConfig = {
  /**
   * The application boundary. A business decision, not a technical one — review
   * it with whoever signs the contract, not only with the team.
   */
  boundary: {
    /**
     * Infrastructure stores, excluded from the count: session tokens, audit
     * trails, queues, caches.
     *
     * Complements the automatic technical-data filter (AFP §6.5.2.1.1), which
     * already catches session, error, search and template names. Exclusions
     * made here also appear in the report, with the reason.
     */
    infrastructure?: string[]
    /**
     * Stores maintained by another system: counted as EIF instead of ILF.
     *
     * For example, tables mirrored from an external ERP.
     */
    externallyMaintained?: string[]
    /**
     * Stores the AFP naming filter excluded, which are business data here.
     *
     * The filter (§6.5.2.1.1, patterns in §6.5.2.1.3) catches names containing
     * `session`, `template`, `error`, `types` and so on, because in most
     * applications those hold infrastructure. When they hold the business —
     * a chat session the user manages, a document template they maintain — the
     * exclusion is wrong and no heuristic can know it. This wins over the
     * filter, and the report says which stores were brought back.
     *
     * It is the counterpart of `infrastructure`: that one excludes what the
     * filter missed, this one restores what it caught by accident.
     */
    business?: string[]
    /**
     * The naming conventions of the technical-data filter (AFP §6.5.2.1.3),
     * tested against the physical table name.
     *
     * When set, this list REPLACES the defaults — the spec treats the patterns
     * as user input, and a team whose business tables end in `_types` needs to
     * drop that one, not add to it. `DEFAULT_TECHNICAL_PATTERNS` is exported to
     * start from. Every exclusion still appears in the report with its label.
     */
    technicalPatterns?: TechnicalPattern[]
    /**
     * Entry points with no functional value to the user, by route name or by
     * identity (`GET /health`).
     *
     * Rarely needed in practice: an infrastructure route reaches no data store
     * and already drops out. It stays as a safety net and to make the intent
     * explicit in the report.
     */
    ignoreEntryPoints?: string[]
  }

  /**
   * How tables fold into data functions — counting-decisions §10.
   *
   * `usage` (the default): a composition child (`hasMany` / `hasOne`) that no
   * application code addresses directly is a RET of its parent, not an ILF of
   * its own — the user only ever sees it inside the parent. `none` keeps every
   * table its own data function at RET 1, which is what rule sets before 1.5.0
   * did; it exists to compare against an old count, not as a preference.
   */
  dataFunctions?: {
    grouping?: 'usage' | 'none'
  }

  /**
   * @deprecated Removed in 0.6.0 — it is no longer read. RET comes from
   * `dataFunctions.grouping`. Left in the type so an old configuration still
   * loads, and `fp:count` warns that the key has no effect.
   */
  retStrategy?: 'constant' | 'composition'

  /**
   * Maximum depth in the call graph, starting at the handler.
   *
   * Too deep and a large shared service contaminates its callers; too shallow
   * and the write is missed.
   */
  maxDepth: number

  /**
   * Extra DET for the confirmation or error message.
   *
   * The IFPUG manual counts one, AFP does not — a known systematic divergence
   * of −1 DET per transaction against manual counts. The default follows AFP.
   */
  messageDet: number

  /** Complexity bands, for calibrating against manual counts. */
  complexityTables?: Partial<Record<FunctionType, ComplexityTable>>

  /** Weights per type and complexity. */
  weights?: Partial<Record<FunctionType, Record<Complexity, number>>>

  /**
   * How change is priced, for `fp:diff`. A clause of the contract, not a flag.
   *
   * The AEP anchors are explicit for added (1) and deleted (0.4). For a modified
   * function AEP grades the factor from 0.25 to 1.75 through Effort Complexity
   * variation, which needs cyclomatic complexity this package does not measure —
   * so it defaults to 1, which overestimates, and every diff says so.
   *
   * `reasonFactors` is the lever the default leaves on the table. The tool
   * already distinguishes a change of type, a change of size, and a change of
   * implementation only — same type, same DET, same FTR, different body — and on
   * a real pair of releases the last was 151 of 378 FP billed as change. Pricing
   * a refactor at full functional value is not defensible; pricing it at a number
   * this package invented would be worse. So the number comes from the contract.
   */
  diff?: {
    factors?: Partial<ChangeFactors>
    reasonFactors?: ChangeReasonFactors
  }

  /**
   * Custom tracing strategies, added to the built-in ones and running
   * **before** them.
   *
   * This is what makes the architecture's central claim true: AdonisJS imposes
   * no code organisation, so a project with its own convention registers it
   * here.
   */
  resolvers?: { call?: CallResolver[] }

  /**
   * Minimum tracing coverage, from 0 to 1.
   *
   * Below it the analysis **fails** instead of emitting a number that looks
   * right. A total resting on many unresolved calls should not become an
   * invoice.
   */
  minCoverage?: number

  /**
   * What a person declares about a DET the analysis cannot read, keyed by its
   * ORIGIN — counting-decisions §8:
   *
   *   'Petition.components'              a JSON column (model or table name)
   *   'savePetitionValidator.components' an open field of a validator
   *
   * A declaration applies to every function carrying that DET: the data
   * function and each transaction that takes or shows the column. Keyed by
   * function it had to be repeated, and still left the transactions nobody
   * wrote it for at the floor — the same column worth two numbers in one count.
   *
   * `schemas` names the JSON Schema(s) in the code whose fields replace the
   * floor; `reviewed` records that 1 is the right answer. Both require `reason`,
   * and `fp:count` reports how much of the total came from a declaration so it
   * cannot grow unnoticed.
   */
  opaque?: Record<string, OpaqueDeclaration>

  /**
   * A declared DET or RET for ONE function, keyed by the name it has in the
   * count (`Invoice`, `POST /books`) — the last resort, for a fact that is not
   * in the code at all (a schema that lives only in the database).
   *
   * `reason` is required, and that is the whole point. A declared number is
   * reproducible — it lives in a versioned file, so the same revision yields
   * the same count — and auditable, because `fp:explain` prints it with its
   * justification. But it freezes: prefer `opaque.<origin>.schemas` whenever the
   * fields are declared anywhere in the code.
   */
  overrides?: Record<string, FunctionOverride>
}

export type FunctionOverride = {
  /** declared DET count, replacing what the analysis found */
  det?: number
  /** declared RET (data function) or FTR (transaction) */
  refs?: number
  /**
   * @deprecated Moved to `opaque.<Store.column | validator.field>.schemas` in
   * 0.6.0 — a schema is a fact about the column, not about one function. No
   * longer read here; `fp:count` warns when it is present.
   */
  detFromSchema?: string | string[]
  /**
   * @deprecated Moved to `opaque.<Store.column | validator.field>.reviewed` in
   * 0.6.0, keyed exactly: matching by bare name meant reviewing `Message.schema`
   * reviewed every `schema` column of every table. No longer read here.
   */
  opaqueReviewed?: string[]
  /** why — required, and printed by `fp:explain` beside the number */
  reason: string
}

export type { OpaqueDeclaration }

export const DEFAULTS: FunctionPointsConfig = {
  boundary: {},
  dataFunctions: { grouping: 'usage' },
  maxDepth: 3,
  messageDet: 0,
}

export function defineConfig(config: Partial<FunctionPointsConfig>): FunctionPointsConfig {
  return {
    ...DEFAULTS,
    ...config,
    boundary: { ...DEFAULTS.boundary, ...config.boundary },
    dataFunctions: { ...DEFAULTS.dataFunctions, ...config.dataFunctions },
  }
}
