import type { ComplexityTable } from './albrecht/tables.js'
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
