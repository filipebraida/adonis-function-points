import type { AppContext } from '../inventory/app_context.js'
import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { CollectedEntryPoint } from '../inventory/sources/routes_ast.js'
import type { Behavior } from '../inventory/graph/call_graph.js'
import type { Complexity, CountResult, CountedFunction, FunctionType } from '../types.js'
import { DEFAULT_TABLES, DEFAULT_WEIGHTS } from './tables.js'
import type { ComplexityTable } from './tables.js'
import { countDataFunctions } from './data_functions.js'
import type { StoreUsage } from './data_functions.js'
import { countTransactionalFunctions } from './transactional_functions.js'
import { isTechnical } from './technical_filter.js'

/**
 * Assembles the count from the inventory.
 *
 * The order is not arbitrary: data functions depend on HOW transactions use
 * each store (AFP §6.5.4), and transactional functions depend on which stores
 * ended up counted. Hence: usage first, then the technical filter, then data,
 * then transactions.
 */

export const RULESET = 'afp'

/**
 * Version of the rule set.
 *
 * It appears in every report, and `fp:diff` refuses to compare counts produced
 * by different versions — otherwise the difference would measure the rule
 * change rather than the work.
 */
export const RULESET_VERSION = '1.0.0'

export type CountInput = {
  app: AppContext
  stores: CollectedDataStore[]
  entryPoints: CollectedEntryPoint[]
  /** behaviour keyed by `EntryPoint.id`; absent means no handler */
  behaviors: Map<string, Behavior>
}

export type CountOptions = {
  retStrategy?: 'constant' | 'composition'
  boundary?: {
    infrastructure?: string[]
    externallyMaintained?: string[]
    ignoreEntryPoints?: string[]
  }
  messageDet?: number
  complexityTables?: Partial<Record<FunctionType, ComplexityTable>>
  weights?: Partial<Record<FunctionType, Record<Complexity, number>>>
}

export function count(input: CountInput, options: CountOptions = {}): CountResult {
  const warnings: string[] = []

  // 1. how each store is used by the transactions
  const usage = usageOf(input)

  const tables = { ...DEFAULT_TABLES, ...options.complexityTables }
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights }
  const infrastructure = new Set(options.boundary?.infrastructure ?? [])

  // 2. technical data filter — AFP §6.5.2.1.1, plus the configured boundary
  const countable = input.stores.filter((store) => {
    if (infrastructure.has(store.name) || infrastructure.has(store.table ?? '')) {
      warnings.push(`excluded by boundary configuration: ${store.name}`)
      return false
    }
    const technical = isTechnical(store)
    if (technical) warnings.push(`technical, excluded: ${store.name} (${technical})`)
    return !technical
  })

  // 3. data functions
  const dataFunctions = countDataFunctions(countable, usage, {
    retStrategy: options.retStrategy ?? 'constant',
    externallyMaintained: new Set(options.boundary?.externallyMaintained ?? []),
    tables,
    weights,
  })

  // 4. transactional functions, over the stores that actually count
  const countedStores = new Map(
    dataFunctions.map((fn) => [fn.name, countable.find((store) => store.name === fn.name)!])
  )

  const ignored = new Set(options.boundary?.ignoreEntryPoints ?? [])
  const entryPoints = input.entryPoints.filter(
    (entry) => !ignored.has(entry.identity) && !ignored.has(entry.name ?? '')
  )

  const transactionalFunctions = countTransactionalFunctions(entryPoints, input.behaviors, {
    countedStores,
    messageDet: options.messageDet ?? 0,
    tables,
    weights,
  })

  const functions = [...dataFunctions, ...transactionalFunctions]

  return {
    ruleset: RULESET,
    rulesetVersion: RULESET_VERSION,
    functions,
    totals: totalsOf(functions),
    confidence: confidenceOf(input, warnings),
  }
}

/**
 * How each store is used by the transactions.
 *
 * `written` decides ILF vs EIF; `used` decides whether it is counted at all.
 */
function usageOf(input: CountInput): Map<string, StoreUsage> {
  const usage = new Map<string, StoreUsage>()

  for (const entry of input.entryPoints) {
    const behavior = input.behaviors.get(entry.id)
    if (!behavior) continue

    for (const store of behavior.touches) {
      const current = usage.get(store) ?? { written: false, used: false }
      usage.set(store, {
        used: true,
        // a single writing transaction is enough for the store to be maintained
        written: current.written || behavior.writes,
      })
    }
  }

  return usage
}

const EMPTY_BY_TYPE: Record<FunctionType, { count: number; points: number }> = {
  ILF: { count: 0, points: 0 },
  EIF: { count: 0, points: 0 },
  EI: { count: 0, points: 0 },
  EO: { count: 0, points: 0 },
  EQ: { count: 0, points: 0 },
}

function totalsOf(functions: CountedFunction[]): CountResult['totals'] {
  const byType = structuredClone(EMPTY_BY_TYPE)
  const byModule: Record<string, number> = {}
  let unadjusted = 0

  for (const fn of functions) {
    byType[fn.type].count++
    byType[fn.type].points += fn.points
    byModule[fn.module] = (byModule[fn.module] ?? 0) + fn.points
    unadjusted += fn.points
  }

  return { unadjusted, byType, byModule }
}

/**
 * Confidence of the count.
 *
 * AFP §6.5.3 requires whatever could not be traced to appear in the report. A
 * total resting on many unresolved calls should not become an invoice, and the
 * reader must see that without having to go looking.
 */
function confidenceOf(input: CountInput, warnings: string[]): CountResult['confidence'] {
  let unresolvedCalls = 0
  let withoutHandler = 0

  for (const entry of input.entryPoints) {
    const behavior = input.behaviors.get(entry.id)
    if (!behavior) {
      withoutHandler++
      continue
    }
    unresolvedCalls += behavior.unresolved.length
  }

  return { unresolvedCalls, entryPointsWithoutHandler: withoutHandler, warnings }
}
