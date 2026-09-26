import { relativeTo } from '../inventory/paths.js'
import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { CollectedEntryPoint } from '../inventory/sources/routes_ast.js'
import type { Behavior } from '../inventory/graph/call_graph.js'
import type { Complexity, CountedFunction, FunctionType } from '../types.js'
import { complexityOf, pointsOf } from './tables.js'
import type { ComplexityTable } from './tables.js'
import type { StoreGrouping } from './data_functions.js'
import { isOpaqueType } from './opaque.js'

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
   * How the stores fold into data functions — counting-decisions §10. A
   * transaction touching a detail and its master touches ONE logical file: one
   * FTR, and the detail's link to the master is not an output DET.
   */
  grouping: StoreGrouping
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
  /**
   * Application root, used only to relativise the paths that LEAVE in the trace.
   *
   * `CountSource.app` is documented as never being the absolute path, because it
   * says where the machine keeps its files and travels with every count sent
   * anywhere. The trace shipped the absolute path regardless — 858 times in a
   * single production count, which is most of the artefact a ledger would store.
   */
  root: string
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

    /**
     * FTR counts logical files, not tables: the master and the detail folded
     * into it are one. `reaches:Pedido (via ItemPedido)` keeps the path visible.
     */
    const { rootOf } = options.grouping
    const viaOf = new Map<string, string[]>()
    for (const store of touched) {
      const root = rootOf.get(store) ?? store
      const via = viaOf.get(root) ?? []
      if (root !== store) via.push(store)
      viaOf.set(root, via)
    }
    const refs = viaOf.size

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
        refSources: [...viaOf.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([root, via]) => `reaches:${root}${via.length ? ` (via ${via.join(', ')})` : ''}`),
        trace: behavior.trace.map((step) => ({
          ...step,
          file: relativeTo(options.root, step.file),
        })),
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
 * (`transformer:` / `select:` / `output:`) so `fp:calibrate` can measure the
 * bias per origin.
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

  /**
   * `(opaque)` is not decoration: `detFromSchema` replaces the opaque placeholder
   * with a schema's fields, and it used to assume there was exactly one and that
   * it was worth 1. An open `vine.object` counted zero, so the subtraction ate a
   * real field — off by one, in the direction of undercounting.
   */
  const opaqueInputs = new Set(behavior.opaqueInputFields)

  for (const field of behavior.inputFields) {
    const name = field.split('.').pop()!
    add(name, `validator:${field}${opaqueInputs.has(field) ? ' (opaque)' : ''}`)
  }

  /**
   * §7.2 asks whether a user-recognisable field crosses the boundary, not how it
   * was declared. `request.input('title')` does, and counted for nothing while
   * input DETs came only from VineJS — so a transaction reading six fields this
   * way sat at 1 DET, the floor of its band.
   *
   * After the validator, and deduplicated by field name: where both exist the
   * validator is the better provenance to print, and the same field must not be
   * paid for twice.
   */
  for (const field of behavior.requestFields) add(field, `request:${field}`)

  // output: only a transaction that presents data has output fields
  if (type === 'EO' || type === 'EQ') {
    /**
     * counting-decisions §6, in order of what is visible:
     *
     *   transformer   its keys are what crosses the boundary; the stores' columns
     *                 are NOT added on top — what it does not emit does not leave
     *   select        the store contributes only the columns named
     *   nothing       every column of the store, which overestimates on purpose
     *
     * An unreadable spread in a transformer is a placeholder at 1 DET, marked
     * `(opaque)` like an open input object, and the counter reports it.
     */
    const opaqueOutputs = new Set(behavior.opaqueOutputFields)
    const viaTransformer = behavior.outputFields.length > 0

    if (viaTransformer) {
      for (const field of behavior.outputFields) {
        add(field, `transformer:${field}${opaqueOutputs.has(field) ? ' (opaque)' : ''}`)
      }
    } else {
      for (const store of touched) {
        /**
         * The key and the system timestamps are not DETs however they leave —
         * selected by name or as part of the whole table. Same ground as on the
         * data function: the user neither supplies nor recognises them (§6).
         */
        const attributes = options.countedStores.get(store)!.attributes
        const excluded = new Set([
          ...attributes.filter((a) => a.isIdentifier || a.system).map((a) => a.name),
          // a detail's link to the master it is folded into: not a DET of the group (§10)
          ...(options.grouping.linkColumns.get(store) ?? []),
        ])
        const selected = behavior.selectedColumns[store]

        /**
         * A JSON column leaving the boundary is as unreadable here as on the data
         * function: 1 DET, marked, so a declaration about the column (§8) reaches the
         * transactions that show it and not only the store.
         */
        const opaqueOf = new Map(attributes.map((a) => [a.name, isOpaqueType(a.type)]))
        const mark = (column: string) => (opaqueOf.get(column) ? ' (opaque)' : '')

        if (selected && selected.length > 0) {
          for (const column of selected) {
            if (excluded.has(column)) continue
            add(`${store}.${column}`, `select:${store}.${column}${mark(column)}`)
          }
          continue
        }

        for (const column of attributes) {
          if (excluded.has(column.name)) continue
          add(`${store}.${column.name}`, `output:${store}.${column.name}${mark(column.name)}`)
        }
      }
    }
  }

  let det = counted.size + options.messageDet
  if (options.messageDet > 0) sources.push('message:1')

  return { det: Math.max(det, 1), sources }
}
