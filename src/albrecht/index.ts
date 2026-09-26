/**
 * Counting engine — IFPUG / OMG-AFP lineage.
 *
 * "Albrecht" names the FAMILY of rules, not just the person: measurement
 * literature says "Albrecht function points" to separate this lineage from
 * COSMIC, which counts data movements and yields incompatible numbers.
 *
 * Normative reference: OMG Automated Function Points 1.0 / ISO/IEC 19515.
 */
export * from './tables.js'
export * from './technical_filter.js'
export * from './counter.js'
export * from './diff.js'
export * from './calibration.js'
