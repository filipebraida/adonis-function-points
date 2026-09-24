import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { CollectedEntryPoint } from '../inventory/sources/routes_ast.js'
import type { Behavior } from '../inventory/graph/call_graph.js'
import type { CountedFunction, FunctionType } from '../types.js'
import { complexityOf, pointsOf } from './tables.js'

/**
 * Funções transacionais: EE e SE.
 *
 *   "Transactions that modify data entities content shall be considered
 *    External Inputs (EI). […] Transactions that do not modify data entities
 *    content but only use them shall be considered as External Output."
 *   — AFP §6.5.3
 *
 * CE não existe aqui, e é decisão da norma, não simplificação nossa:
 *
 *   "Since the primary intent cannot be assessed by an automated function point
 *    counting tool, all outputs and inquiries shall be counted as external
 *    outputs (EO)."  — AFP §6.5.3
 */

export type TransactionOptions = {
  /** repositórios que entram na contagem; os demais não somam FTR */
  countedStores: Map<string, CollectedDataStore>
  /**
   * DET extra por mensagem de confirmação/erro.
   *
   * O manual do IFPUG conta 1; o AFP não. Segue o AFP por default, e fica
   * configurável porque foi a divergência sistemática de −1 DET por transação
   * medida na dissertação do Ligeiro.
   */
  messageDet: number
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
     * counting-decisions §1: sem caminho até dado nenhum, não há transação a
     * identificar. Cai da regra geral, sem caso especial para rota estática.
     */
    if (touched.length === 0) continue

    const type: FunctionType = behavior.writes ? 'EI' : 'EO'
    const refs = touched.length

    const { det, sources } = detsFor(entry, behavior, touched, options)
    const complexity = complexityOf(type, refs, det)

    counted.push({
      id: `tx:${entry.identity}`,
      name: entry.identity,
      module: entry.module,
      type,
      det,
      refs,
      complexity,
      points: pointsOf(type, complexity),
      rationale: {
        rule: behavior.writes
          ? 'afp:6.5.3 modifica repositório de dados -> EE'
          : 'afp:6.5.3 usa sem modificar -> SE (CE colapsado por 6.5.3)',
        detSources: sources,
        refSources: touched.map((store) => `alcança:${store}`),
        trace: behavior.trace,
      },
    })
  }

  return counted
}

/**
 * DETs de uma transação — counting-decisions §6 e §7.
 *
 * Entrada: parâmetros da rota, um DET cada. Saída: campos dos repositórios
 * lidos. Sem `.select()` nem transformer visível, conta a tabela inteira e
 * **superestima** — troca que o AFP faz de propósito, priorizando
 * repetibilidade sobre fidelidade. A origem vai no `Rationale` para o
 * `fp:calibrate` medir o viés.
 */
function detsFor(
  entry: CollectedEntryPoint,
  behavior: Behavior,
  touched: string[],
  options: TransactionOptions
): { det: number; sources: string[] } {
  const sources: string[] = []
  let det = 0

  const params = entry.signature.match(/:[A-Za-z_][\w]*/g) ?? []
  for (const param of params) {
    det++
    sources.push(`param:${param}`)
  }

  for (const field of behavior.inputFields) {
    det++
    sources.push(`validator:${field}`)
  }

  // saída: campos dos repositórios lidos, quando não há entrada declarada
  if (behavior.inputFields.length === 0) {
    for (const store of touched) {
      const columns = options.countedStores
        .get(store)!
        .attributes.filter((attribute) => !attribute.isIdentifier)
      det += columns.length
      sources.push(`all-columns:${store}(${columns.length})`)
    }
  }

  det += options.messageDet
  if (options.messageDet > 0) sources.push('message:1')

  return { det: Math.max(det, 1), sources }
}
