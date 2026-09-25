export { configure } from './configure.js'
export { defineConfig } from './src/define_config.js'
export type { FunctionPointsConfig, FunctionOverride } from './src/define_config.js'
export * from './src/types.js'

/**
 * Counting, programmatically.
 *
 * The two front-ends were the only way to reach any of this, so anything built on
 * top of the package — a ledger, a dashboard, a billing job — had to shell out to
 * the CLI and parse its output. That is the same defect as the configuration
 * nobody read and the metrics nobody could run, one layer up.
 */
export { analyze, CoverageTooLowError } from './src/pipeline.js'
export type { Analysis, AnalysisOptions } from './src/pipeline.js'

/**
 * Which rules produced a number.
 *
 * A ledger row without them cannot be compared to another one: `diffCounts`
 * refuses counts from different rule sets, and a stored count needs to carry what
 * it was measured with.
 */
export { RULESET, RULESET_VERSION } from './src/albrecht/counter.js'

/** Change, and what it bills at — AEP §6.3 and §6.5. */
export {
  AEP_FACTORS,
  diffCounts,
  IncomparableRulesetsError,
  IncomparableSourcesError,
} from './src/albrecht/diff.js'
export type {
  ChangeFactors,
  ChangeReasonFactors,
  DiffOptions,
  FunctionPointDiff,
} from './src/albrecht/diff.js'

/** The counterweight: density, coupling and conformance over the same inventory. */
export { measureConformance, measureStructure } from './src/metrics/structure.js'
export type { Conformance, ModuleMetrics, StructureMetrics } from './src/metrics/structure.js'

/** Correction factors against a manual count. */
export { calibrate, parseSamples } from './src/albrecht/calibration.js'
export type { Calibration, CalibrationSample, TypeCalibration } from './src/albrecht/calibration.js'

/** Tracing strategies: the one public extension point. */
export { BUILTIN_CALL_RESOLVERS } from './src/inventory/resolvers/index.js'
export type { CallResolver, ResolverContext } from './src/inventory/resolvers/types.js'
