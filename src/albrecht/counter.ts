import type { AppContext } from '../inventory/app_context.js'
import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { CollectedEntryPoint } from '../inventory/sources/routes_ast.js'
import type { Behavior } from '../inventory/graph/call_graph.js'
import type { DiscoveredSchema } from '../inventory/sources/json_schemas.js'
import type { Complexity, CountResult, CountedFunction, FunctionType } from '../types.js'
import { DEFAULT_TABLES, DEFAULT_WEIGHTS, complexityOf, pointsOf } from './tables.js'
import type { FunctionOverride } from '../define_config.js'
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
  /** JSON Schema literals found in the code, for `detFromSchema` — §8 */
  jsonSchemas?: Map<string, DiscoveredSchema>
  /**
   * Stores written anywhere in the application's code, reachable from an entry
   * point or not — AFP §6.5.4 asks who MAINTAINS the store, and a job or a
   * seeder is this application just as much as a route is.
   */
  writtenAnywhere?: Set<string>
}

export type CountOptions = {
  retStrategy?: 'constant' | 'composition'
  /** declared DET/RET for what static analysis cannot read — see §8 */
  overrides?: Record<string, FunctionOverride>
  boundary?: {
    infrastructure?: string[]
    externallyMaintained?: string[]
    /** restores what the AFP naming filter caught by accident */
    business?: string[]
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
  const business = new Set(options.boundary?.business ?? [])

  const countable = input.stores.filter((store) => {
    if (infrastructure.has(store.name) || infrastructure.has(store.table ?? '')) {
      warnings.push(`excluded by boundary configuration: ${store.name}`)
      return false
    }

    const technical = isTechnical(store)
    if (!technical) return true

    /**
     * The naming filter is a heuristic over names, so it catches business data
     * whose name happens to match — a chat session the user manages, a document
     * template they maintain. Only a person knows which, so a declaration wins
     * over the pattern, and the report says it was overruled rather than
     * quietly counting one more store.
     */
    if (business.has(store.name) || business.has(store.table ?? '')) {
      warnings.push(
        `kept by boundary configuration: ${store.name} — the AFP naming filter had excluded it ` +
          `(${technical})`
      )
      return true
    }

    warnings.push(`technical, excluded: ${store.name} (${technical})`)
    return false
  })

  // 3. data functions
  const dataFunctions = countDataFunctions(countable, usage, {
    writtenAnywhere: input.writtenAnywhere ?? new Set(),
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

  warnings.push(...opaqueColumnWarnings(countable, input))

  const functions = applyOverrides(
    [...dataFunctions, ...transactionalFunctions],
    options.overrides ?? {},
    input.jsonSchemas ?? new Map(),
    tables,
    weights,
    warnings
  )

  return {
    ruleset: RULESET,
    rulesetVersion: RULESET_VERSION,
    functions,
    totals: totalsOf(functions),
    confidence: confidenceOf(input, warnings),
  }
}

/**
 * Columns whose content static analysis cannot read — counting-decisions §8.
 *
 * A JSON column holding a form the user fills counts as 1 DET, because the
 * schema is runtime data. That is the documented trade, and until now it was
 * documented ONLY: the count said nothing, which is the one known blind spot
 * this package reported nowhere. It reports an unresolved call, a technical
 * table, an unresolved mixin and a handler-less route — and stayed silent here.
 *
 * Only columns on a store some transaction reaches are named. An untouched
 * `metadata` column changes no number, and warning about it would be the noise
 * that teaches people to stop reading the confidence block.
 */
function opaqueColumnWarnings(stores: CollectedDataStore[], input: CountInput): string[] {
  const reached = new Map<string, number>()
  for (const entry of input.entryPoints) {
    for (const store of input.behaviors.get(entry.id)?.touches ?? []) {
      reached.set(store, (reached.get(store) ?? 0) + 1)
    }
  }

  const found: string[] = []

  for (const store of stores) {
    const transactions = reached.get(store.name)
    if (!transactions) continue

    for (const attribute of store.attributes) {
      if (!attribute.type || !OPAQUE_TYPE.test(attribute.type)) continue
      found.push(
        `  ${store.name}.${attribute.name} (${attribute.type}) — ${transactions} transaction(s)`
      )
    }
  }

  if (found.length === 0) return []

  // the advice once, then the list: repeating it per column is a wall nobody reads
  return [
    `${found.length} opaque column(s), each counted as 1 DET. If the user recognises fields ` +
      `inside one, declare the count with \`overrides\` — counting-decisions §8:`,
    ...found,
  ]
}

/** a column whose shape says nothing about what it holds */
const OPAQUE_TYPE = /^(object|any|unknown|Record<|Json|JSON)/

/**
 * Replaces what the analysis found with what a person declared.
 *
 * Only for facts static analysis cannot reach — a JSON column whose schema
 * lives in the database, per counting-decisions §8. The declared number is
 * reproducible because it comes from a versioned file, and auditable because it
 * travels with its justification into the rationale, which `fp:explain` prints.
 *
 * An override naming no function is a warning, never silence: a typo in the key
 * would otherwise mean the declaration did nothing and nobody was told.
 */
function applyOverrides(
  functions: CountedFunction[],
  overrides: Record<string, FunctionOverride>,
  schemas: Map<string, DiscoveredSchema>,
  tables: Record<FunctionType, ComplexityTable>,
  weights: Record<FunctionType, Record<Complexity, number>>,
  warnings: string[]
): CountedFunction[] {
  const keys = Object.keys(overrides)
  if (keys.length === 0) return functions

  const used = new Set<string>()

  const applied = functions.map((fn) => {
    const override = overrides[fn.name]
    if (!override) return fn

    used.add(fn.name)

    const fields: ('det' | 'refs')[] = []
    if (override.det !== undefined || override.detFromSchema) fields.push('det')
    if (override.refs !== undefined) fields.push('refs')

    let det = override.det ?? fn.det
    let by = `config:overrides.${fn.name}`

    /**
     * Read from the schema rather than declared as a number.
     *
     * A frozen number goes stale the moment someone adds a field: the count
     * would not move and `fp:diff` would report no change for real functional
     * growth. Naming the schema keeps the number coming from the code, and the
     * only thing maintained by hand is the mapping — which changes when a form
     * is born, not when a field is.
     */
    if (override.detFromSchema) {
      const schema = schemas.get(override.detFromSchema)
      if (schema) {
        // the opaque column contributed exactly 1 DET; the schema says how many
        det = Math.max(fn.det - 1, 0) + schema.fields
        by = `config:overrides.${fn.name} (from ${schema.name}: ${schema.fields} fields)`
      } else {
        warnings.push(
          `override for "${fn.name}" names schema "${override.detFromSchema}", which is not ` +
            `declared anywhere in the code: the DET count was left as found. A renamed or moved ` +
            `schema breaks the mapping, and this says so rather than counting on silently.`
        )
      }
    }

    const refs = override.refs ?? fn.refs
    const complexity = complexityOf(fn.type, refs, det, tables)

    return {
      ...fn,
      det,
      refs,
      complexity,
      points: pointsOf(fn.type, complexity, weights),
      rationale: {
        ...fn.rationale,
        overrides: [...(fn.rationale.overrides ?? []), { by, reason: override.reason, fields }],
      },
    }
  })

  for (const key of keys) {
    if (!used.has(key)) {
      warnings.push(`override "${key}" matched no counted function: the declaration had no effect`)
    }
  }

  return applied
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
