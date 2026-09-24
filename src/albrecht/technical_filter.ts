import type { CollectedDataStore } from '../inventory/sources/data_stores.js'

/**
 * Filtro de dados temporários e técnicos — AFP §6.5.2.1.1.
 *
 *   "Database tables identified as temporary or technical shall be marked as
 *    such to be presented in the final report, and shall be ignored in the rest
 *    of this process."
 *
 * Devolve o motivo quando a tabela é técnica, e `null` quando não é — porque o
 * relatório tem que dizer POR QUE excluiu, não só que excluiu.
 */

/**
 * Convenções de nome, com os defaults do próprio spec (§6.5.2.1.3).
 *
 * São parâmetros de entrada na norma, então ficam sobrescrevíveis pela
 * configuração de fronteira.
 */
export const DEFAULT_TECHNICAL_PATTERNS: { label: string; pattern: RegExp }[] = [
  {
    label: 'entidade temporária',
    pattern: /^(.+temp|.*session.*|.*error.*|.*search.*|.*login.*|.*logon.*|.*filter.*)$/i,
  },
  { label: 'entidade de status', pattern: /^(.+status)$/i },
  { label: 'entidade de lookup', pattern: /^(lkp_.+|.+types?|.+_t)$/i },
  { label: 'entidade de template', pattern: /^(.*template.*)$/i },
]

export function isTechnical(
  store: CollectedDataStore,
  patterns = DEFAULT_TECHNICAL_PATTERNS
): string | null {
  const table = store.table ?? store.name

  for (const { label, pattern } of patterns) {
    if (pattern.test(table)) return `${label} (AFP §6.5.2.1.3: ${pattern.source})`
  }

  return null
}
