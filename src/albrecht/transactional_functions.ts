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

    const { det, sources } = detsFor(entry, behavior, touched, type, options)
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
      scopeHash: scopeHashOf(behavior),
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
 * Hash combinado do escopo de implementação, para o `fp:diff`.
 *
 * Ordenado antes de combinar: a ordem de travessia pode variar sem que o código
 * tenha mudado, e um hash instável faria toda release virar "alteração".
 */
function scopeHashOf(behavior: Behavior): string {
  return behavior.scope
    .map((entry) => `${entry.member ?? '*'}:${entry.bodyHash}`)
    .sort()
    .join('|')
}

/**
 * DETs de uma transação — counting-decisions §6 e §7.
 *
 *   "Count only one DET for each unique field that is required to complete the
 *    External Input. […] Count only one DET for each unique field that is
 *    required to complete the Output Transaction. If a DET both enters and exits
 *    the boundary, count that DET only once."  — AFP §7.3
 *
 * A distinção que importa é por TIPO de transação, não por ter entrada ou não:
 *
 *   EE  campos que o usuário informa — parâmetros de rota e validator. O que a
 *       transação lê para poder gravar não é DET de entrada.
 *   SE  o que o usuário informa MAIS o que a transação apresenta. Um relatório
 *       tem os dois: o período consultado e os campos exibidos.
 *
 * A primeira versão deste código tratava saída como `else` da entrada, e por
 * isso contava 2 DETs num relatório que o gabarito conta com 9 — e 8 numa
 * exclusão que o gabarito conta com 2. O benchmark Vazquez expôs os dois.
 *
 * Sem `.select()` nem transformer visível, os campos de saída são a tabela
 * inteira, e isso **superestima**. É a troca que o AFP faz de propósito,
 * priorizando repetibilidade sobre fidelidade; a origem vai no `Rationale` para
 * o `fp:calibrate` medir o viés.
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

  // saída: só transação que apresenta dado tem campo de saída
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
