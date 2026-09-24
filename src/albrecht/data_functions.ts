import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { Complexity, CountedFunction, FunctionType } from '../types.js'
import { complexityOf, pointsOf } from './tables.js'
import type { ComplexityTable } from './tables.js'

/**
 * Data functions: ILF and EIF.
 *
 * The classification does not come from the model's own code — it comes from
 * HOW the application's transactions use the store:
 *
 *   "If the Data Function is maintained by any of the application's
 *    Transactional Functions, the Data Function shall be determined to be an
 *    ILF. […] If a Data Function is not used in any of the processing of an
 *    application's Transactional Functions, the Data Function shall not be
 *    counted in the application."  — AFP §6.5.4
 *
 * That is why this module takes usage, not just the stores.
 */

export type StoreUsage = {
  /** does any transaction of the application write to this store? */
  written: boolean
  /** does any transaction reach it at all, reading or writing? */
  used: boolean
}

export type DataFunctionOptions = {
  /** `constant` pins RET at 1; `composition` derives it from composition relations */
  retStrategy: 'constant' | 'composition'
  /** stores maintained by another system, by boundary decision */
  externallyMaintained: Set<string>
  tables: Record<FunctionType, ComplexityTable>
  weights: Record<FunctionType, Record<Complexity, number>>
}

export function countDataFunctions(
  stores: CollectedDataStore[],
  usage: Map<string, StoreUsage>,
  options: DataFunctionOptions
): CountedFunction[] {
  const counted: CountedFunction[] = []

  for (const store of stores) {
    const use = usage.get(store.name)

    // AFP §6.5.4: a store no transaction reaches is not counted
    if (!use?.used) continue

    /**
     * DETs exclude the technical identifier.
     *
     * IFPUG defines a DET as a "user recognizable" attribute, and an
     * auto-increment surrogate key is not something the user recognises.
     * Counting it would inflate every data function by one.
     */
    const detAttributes = store.attributes.filter((attribute) => !attribute.isIdentifier)
    const det = detAttributes.length

    const refs = options.retStrategy === 'composition' ? 1 + store.subgroups.length : 1

    const external = options.externallyMaintained.has(store.name) || !use.written
    const type: FunctionType = external ? 'EIF' : 'ILF'

    const complexity = complexityOf(type, refs, det, options.tables)

    counted.push({
      id: `data:${store.name}`,
      name: store.name,
      module: store.module,
      type,
      det,
      refs,
      complexity,
      points: pointsOf(type, complexity, options.weights),
      rationale: {
        rule: options.externallyMaintained.has(store.name)
          ? 'afp:6.5.4 externally maintained by boundary configuration -> EIF'
          : use.written
            ? 'afp:6.5.4 maintained by an application transaction -> ILF'
            : 'afp:6.5.4 used but not maintained -> EIF',
        detSources: detAttributes.map(
          (attribute) => `${store.columnSource}:${store.table ?? store.name}.${attribute.name}`
        ),
        refSources:
          options.retStrategy === 'composition'
            ? ['1 (main group)', ...store.subgroups.map((s) => `composition:${s}`)]
            : ['1 (constant: a logical subgroup is not derivable from code)'],
      },
    })
  }

  return counted
}
