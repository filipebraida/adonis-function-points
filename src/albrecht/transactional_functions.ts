import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { CollectedEntryPoint } from '../inventory/sources/routes_ast.js'
import type { Behavior } from '../inventory/graph/call_graph.js'
import type { Complexity, CountedFunction, FunctionType } from '../types.js'
import { complexityOf, pointsOf } from './tables.js'
import type { ComplexityTable } from './tables.js'

/**
 * Transactional functions: EI and EO.
 *
 *   "Transactions that modify data entities content shall be considered
 *    External Inputs (EI). […] Transactions that do not modify data entities
 *    content but only use them shall be considered as External Output."
 *   — AFP §6.5.3
 *
 * There is no EQ here, and that is the standard's decision rather than a
 * simplification of ours:
 *
 *   "Since the primary intent cannot be assessed by an automated function point
 *    counting tool, all outputs and inquiries shall be counted as external
 *    outputs (EO)."  — AFP §6.5.3
 */

export type TransactionOptions = {
  /** stores that are counted; anything else contributes no FTR */
  countedStores: Map<string, CollectedDataStore>
  /**
   * Extra DET for the confirmation or error message.
   *
   * The IFPUG manual counts one; AFP does not. The default follows AFP, and it
   * stays configurable because this is a known systematic divergence of −1 DET
   * per transaction against manual counts.
   */
  messageDet: number
  tables: Record<FunctionType, ComplexityTable>
  weights: Record<FunctionType, Record<Complexity, number>>
}

export function countTransactionalFunctions(
  entryPoints: CollectedEntryPoint[],
  behaviors: Map<string, Behavior>,
  options: TransactionOptions
): CountedFunction[] {
  const counted: CountedFunction[] = []

  for (const entry of entryPoints) {
    const behavior = behaviors.get(entry.id)
    if (!behavior) continue

    const touched = behavior.touches.filter((store) => options.countedStores.has(store))

    /**
     * No path down to any data function means there is no transaction to
     * identify (AFP §6.5.3). This falls out of the general rule — no special
     * case is needed for static routes.
     */
    if (touched.length === 0) continue

    const type: FunctionType = behavior.writes ? 'EI' : 'EO'
    const refs = touched.length

    const { det, sources } = detsFor(entry, behavior, touched, type, options)
    const complexity = complexityOf(type, refs, det, options.tables)

    counted.push({
      id: `tx:${entry.identity}`,
      name: entry.identity,
      module: entry.module,
      type,
      det,
      refs,
      complexity,
      points: pointsOf(type, complexity, options.weights),
      scopeHash: scopeHashOf(behavior),
      rationale: {
        rule: behavior.writes
          ? 'afp:6.5.3 modifies a data store -> EI'
          : 'afp:6.5.3 uses without modifying -> EO (EQ collapsed per 6.5.3)',
        detSources: sources,
        refSources: touched.map((store) => `reaches:${store}`),
        trace: behavior.trace,
      },
    })
  }

  return counted
}

/**
 * Combined hash of the implementation scope, consumed by `fp:diff`.
 *
 * Sorted before combining: traversal order can vary without the code having
 * changed, and an unstable hash would turn every release into a "change".
 */
function scopeHashOf(behavior: Behavior): string {
  return behavior.scope
    .map((entry) => `${entry.member ?? '*'}:${entry.bodyHash}`)
    .sort()
    .join('|')
}

/**
 * DETs of a transaction — AFP §7.3.
 *
 *   "Count only one DET for each unique field that is required to complete the
 *    External Input. […] Count only one DET for each unique field that is
 *    required to complete the Output Transaction. If a DET both enters and exits
 *    the boundary, count that DET only once."
 *
 * The distinction that matters is the transaction TYPE, not whether input
 * exists:
 *
 *   EI  fields the user supplies — route parameters and validator fields.
 *       What the transaction reads in order to write is not an input DET.
 *   EO  what the user supplies PLUS what the transaction presents. A report has
 *       both: the period queried and the fields displayed.
 *
 * With no `.select()` and no visible transformer, the output fields are the
 * whole table, which **overestimates**. That is the trade AFP makes on purpose,
 * favouring repeatability over fidelity; the origin is recorded in `Rationale`
 * so `fp:calibrate` can measure the bias.
 */
function detsFor(
  entry: CollectedEntryPoint,
  behavior: Behavior,
  touched: string[],
  type: FunctionType,
  options: TransactionOptions
): { det: number; sources: string[] } {
  const sources: string[] = []
  const counted = new Set<string>()

  const add = (field: string, source: string) => {
    if (counted.has(field)) return
    counted.add(field)
    sources.push(source)
  }

  for (const param of entry.signature.match(/:[A-Za-z_][\w]*/g) ?? []) {
    add(param.slice(1), `param:${param}`)
  }

  for (const field of behavior.inputFields) {
    const name = field.split('.').pop()!
    add(name, `validator:${field}`)
  }

  // output: only a transaction that presents data has output fields
  if (type === 'EO' || type === 'EQ') {
    for (const store of touched) {
      const columns = options.countedStores
        .get(store)!
        .attributes.filter((attribute) => !attribute.isIdentifier)

      for (const column of columns) add(`${store}.${column.name}`, `output:${store}.${column.name}`)
    }
  }

  let det = counted.size + options.messageDet
  if (options.messageDet > 0) sources.push('message:1')

  return { det: Math.max(det, 1), sources }
}
