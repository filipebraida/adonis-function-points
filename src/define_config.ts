import type { ComplexityTable } from './albrecht/tables.js'
import type { ChangeFactors, ChangeReasonFactors } from './albrecht/diff.js'
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
   * Strategy for RET, the logical subgroups of an ILF/EIF.
   *
   * `constant` pins it at 1, which is honest: what a user recognises as a
   * subgroup is not derivable from code. `composition` derives it from
   * composition relations; less accurate in general, but captures real
   * aggregates.
   */
  retStrategy: 'constant' | 'composition'

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
   * Declared DET or RET/FTR for a function the analysis cannot read, keyed by
   * the name it has in the count (`Invoice`, `POST /books`).
   *
   * The case this exists for is a schema-driven application: when the fields a
   * user fills live in a JSON column whose schema is stored in the database,
   * there is nothing for static analysis to read and the column counts as 1 DET
   * (counting-decisions §8). The person who knows the form knows the number.
   *
   * `reason` is required, and that is the whole point. A declared number is
   * reproducible — it lives in a versioned file, so the same revision yields
   * the same count — and auditable, because `fp:explain` prints it with its
   * justification. A number the tool guessed would be neither.
   *
   * Use sparingly. If overriding becomes a habit the count stops coming from
   * the code, and the report says how much of the total came from here so that
   * cannot grow unnoticed.
   */
  overrides?: Record<string, FunctionOverride>
}

export type FunctionOverride = {
  /** declared DET count, replacing what the analysis found */
  det?: number
  /**
   * Name of a JSON Schema declared in the application's code, whose fields are
   * counted by the §7 leaf rules and replace the single DET the opaque column
   * contributed.
   *
   * Prefer this to `det`. A declared number freezes: someone adds a field, the
   * count does not move, and `fp:diff` reports no change for real functional
   * growth — undercounting silently and progressively. Naming the schema keeps
   * the number coming from the code; the only thing maintained by hand is the
   * mapping, which changes when a form is born rather than when a field is.
   *
   * A name that matches no schema is a warning, never a silent fallback.
   */
  detFromSchema?: string
  /** declared RET (data function) or FTR (transaction) */
  refs?: number
  /** why — required, and printed by `fp:explain` beside the number */
  reason: string
}

export const DEFAULTS: FunctionPointsConfig = {
  boundary: {},
  retStrategy: 'constant',
  maxDepth: 3,
  messageDet: 0,
}

export function defineConfig(config: Partial<FunctionPointsConfig>): FunctionPointsConfig {
  return {
    ...DEFAULTS,
    ...config,
    boundary: { ...DEFAULTS.boundary, ...config.boundary },
  }
}
