/**
 * Domain model of the package.
 *
 * Two deliberately independent layers:
 *
 *   Inventory  — raw facts extracted from the application. Knows nothing of FPA.
 *   Albrecht   — IFPUG/AFP rules applied over the inventory.
 *
 * `src/inventory/**` must never import from `src/albrecht/**`.
 */

// ---------------------------------------------------------------------------
// Provenance — every measurement must know where it came from.
// Without it a count is a magic number and nobody can contest it.
// ---------------------------------------------------------------------------
export type Provenance = {
  file: string
  line?: number
  /** name of the collector/resolver/detector that produced the fact */
  by: string
}

export type { CountSource } from './inventory/source.js'
import type { CountSource } from './inventory/source.js'

// ---------------------------------------------------------------------------
// INVENTORY — raw facts
// ---------------------------------------------------------------------------

/** A logical data store persisted by the application. */
export type DataStore = {
  id: string
  /** name as the user would recognise it (model, table) */
  name: string
  module: string
  /** physical table, when known */
  table?: string
  /** persisted attributes, excluding technical identifiers */
  attributes: Attribute[]
  /** candidate logical subgroups (composition relations) */
  subgroups: string[]
  /**
   * Declared relations: property name -> target store name.
   *
   * This is what allows `.preload('author')` to resolve to the `Author` store.
   * Without it, a table read only through a relation is reached by no
   * transaction and drops out of the count under AFP §6.5.4 — when it is in
   * fact a legitimate EIF.
   */
  relations: Record<string, string>
  /** maintained by this application, or by an external system? */
  maintainedExternally: boolean
  provenance: Provenance
}

export type Attribute = {
  name: string
  type?: string
  isIdentifier: boolean
  provenance: Provenance
}

/**
 * An application entry point: HTTP route, ace command, job, listener.
 * Transactions are not only HTTP — a scheduled command that imports a file is
 * as transactional as a POST.
 */
export type EntryPoint = {
  id: string
  kind: 'http' | 'command' | 'job' | 'listener'
  module: string
  /** HTTP verb, command name, event name… */
  trigger: string
  /** route pattern, command signature… */
  signature: string
  /** route name when present; not the identity used across versions */
  name?: string
  handler: HandlerRef | null
  provenance: Provenance
}

export type HandlerRef = {
  file: string
  /** class method; absent for single-action handlers */
  member?: string
  /**
   * Body line, for a handler with no name: an inline closure declared on the
   * route itself (`router.get('/', ({ response }) => …)`).
   *
   * Its body is business code like any other and must be walked by the graph.
   */
  line?: number
}

/** What the code reachable from an EntryPoint actually does. */
export type HandlerBehavior = {
  entryPointId: string
  /** does it write to any DataStore inside the boundary? */
  writes: boolean
  /** DataStores reached (ids) */
  touches: string[]
  /** declared input fields (validators) */
  inputFields: Field[]
  /** declared output fields (transformers, DTOs) */
  outputFields: Field[]
  /** path walked through the call graph — what `fp:explain` prints */
  trace: TraceStep[]
  /** calls no resolver knew how to follow */
  unresolved: UnresolvedCall[]
}

export type Field = {
  name: string
  optional?: boolean
  provenance: Provenance
}

export type TraceStep = {
  file: string
  member?: string
  depth: number
  /** resolver that produced this step */
  by: string
  writes: boolean
}

/**
 * A call the graph could not follow.
 *
 * This is NOT log noise — it is the inventory's coverage metric. Many
 * unresolved calls mean an unreliable count, and the report must say so rather
 * than feign precision.
 */
export type UnresolvedCall = {
  file: string
  line: number
  expression: string
  reason: string
}

export type Inventory = {
  /** format version, for diffs across releases */
  version: 1
  generatedAt: string
  app: string
  /** framework versions the count was made against — goes into the report */
  framework: { core?: number; lucid?: number; orm: string }
  dataStores: DataStore[]
  entryPoints: EntryPoint[]
  behaviors: HandlerBehavior[]
  coverage: {
    entryPointsTotal: number
    entryPointsResolved: number
    unresolvedCalls: number
    /** fraction of entry points whose handler was traced to completion */
    ratio: number
  }
}

// ---------------------------------------------------------------------------
// ALBRECHT — counting
// ---------------------------------------------------------------------------

export type FunctionType = 'ILF' | 'EIF' | 'EI' | 'EO' | 'EQ'
export type Complexity = 'low' | 'average' | 'high'

export type CountedFunction = {
  id: string
  name: string
  module: string
  type: FunctionType
  /** DET — data element types */
  det: number
  /** RET for data functions, FTR for transactional ones */
  refs: number
  complexity: Complexity
  points: number
  /**
   * Hash of the implementation scope.
   *
   * This is what `fp:diff` compares to decide whether a function CHANGED. It
   * combines normalised-AST hashes of the bodies reached, so formatting and
   * comments are excluded: running a formatter must not produce an invoice.
   *
   * Absent for data functions, whose scope is the declaration itself.
   */
  scopeHash?: string
  /** why it was classified this way — feeds `fp:explain` */
  rationale: Rationale
}

export type Rationale = {
  /** rule applied, e.g. 'afp:6.5.3 modifies a data store -> EI' */
  rule: string
  /** where each DET came from */
  detSources: string[]
  /** where the FTR/RET came from */
  refSources: string[]
  /** manual overrides applied via config, with the required justification */
  overrides?: { reason: string; by: string }[]
  trace?: TraceStep[]
}

export type CountResult = {
  /** identifies the rule set — counts are comparable only if these match */
  ruleset: string
  rulesetVersion: string
  /**
   * What was counted: application, revision, whether the tree was dirty.
   *
   * Optional because `count()` can be called directly with an inventory built
   * by hand; every count the CLI writes carries it. Without it two saved counts
   * are comparable in form and meaningless in substance — the same application
   * a month apart looks exactly like a defect in the counter.
   */
  source?: CountSource
  functions: CountedFunction[]
  totals: {
    unadjusted: number
    byType: Record<FunctionType, { count: number; points: number }>
    byModule: Record<string, number>
  }
  /** flags when the count does not deserve confidence */
  confidence: {
    unresolvedCalls: number
    entryPointsWithoutHandler: number
    warnings: string[]
  }
}

/** Maintenance type, for enhancement-project counting. */
export type ChangeType = 'added' | 'changed' | 'removed' | 'unchanged'

export type DiffEntry = {
  function: CountedFunction
  change: ChangeType
  previous?: CountedFunction
}

export type DiffResult = {
  from: string
  to: string
  entries: DiffEntry[]
  totals: Record<ChangeType, { count: number; points: number }>
}
