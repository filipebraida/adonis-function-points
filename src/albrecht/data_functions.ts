import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { Complexity, CountedFunction, FunctionType } from '../types.js'
import { complexityOf, pointsOf } from './tables.js'
import type { ComplexityTable } from './tables.js'

/**
 * Funções de dados: ALI e AIE.
 *
 * A classificação não vem do código do model — vem de COMO as transações da
 * aplicação usam o repositório:
 *
 *   "If the Data Function is maintained by any of the application's
 *    Transactional Functions, the Data Function shall be determined to be an
 *    ILF. […] If a Data Function is not used in any of the processing of an
 *    application's Transactional Functions, the Data Function shall not be
 *    counted in the application."  — AFP §6.5.4
 *
 * Por isso este módulo recebe o uso, não só os repositórios.
 */

export type StoreUsage = {
  /** alguma transação da aplicação escreve neste repositório? */
  written: boolean
  /** alguma transação o alcança, lendo ou escrevendo? */
  used: boolean
}

export type DataFunctionOptions = {
  /** `constant` fixa RET em 1; `composition` deriva das relações de composição */
  retStrategy: 'constant' | 'composition'
  /** repositórios mantidos por outro sistema, por decisão de fronteira */
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

    // AFP §6.5.4: repositório que nenhuma transação alcança não entra
    if (!use?.used) continue

    /**
     * DET exclui o identificador técnico.
     *
     * O IFPUG define DET como atributo "user recognizable"; uma chave
     * auto-incremental não é reconhecida pelo usuário. É também o que a
     * dissertação do Ligeiro fez, e o que mantém a contagem comparável com a
     * manual.
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
          ? 'afp:6.5.4 mantido externamente por configuração de fronteira -> AIE'
          : use.written
            ? 'afp:6.5.4 mantido por transação da aplicação -> ALI'
            : 'afp:6.5.4 usado mas não mantido -> AIE',
        detSources: detAttributes.map(
          (attribute) => `${store.columnSource}:${store.table ?? store.name}.${attribute.name}`
        ),
        refSources:
          options.retStrategy === 'composition'
            ? ['1 (grupo principal)', ...store.subgroups.map((s) => `composição:${s}`)]
            : ['1 (constante: subgrupo lógico não é derivável do código)'],
      },
    })
  }

  return counted
}
