import type { ChangeType, CountResult, CountedFunction, DiffEntry, DiffResult } from '../types.js'

/**
 * Inclusão, alteração e exclusão entre duas contagens — o que vira fatura.
 *
 * Base normativa: **OMG Automated Enhancement Points 1.0**, a spec irmã do AFP,
 * feita para medir manutenção entre duas revisões.
 *
 *   "Each Artifact shall be analyzed in both revisions to determine whether it
 *    is: Added — when it exists in revision ToRevision while it didn't exist in
 *    FromRevision. […] Modified — when it exists in both revisions but whose
 *    source code changed."  — AEP §6.3
 *
 * Duas decisões que tornam isto viável, de counting-decisions §5:
 *
 * 1. **Opera sobre duas contagens salvas**, nunca sobre dois checkouts. Bootar a
 *    versão antiga, com dependências possivelmente diferentes, é exatamente o
 *    tipo de problema que não vale resolver.
 * 2. **Recusa comparar rulesets diferentes.** Se as regras mudaram no meio, o
 *    diff somaria laranjas com maçãs — e o resultado iria para uma fatura.
 */

export class IncomparableRulesetsError extends Error {
  constructor(from: string, to: string) {
    super(
      `contagens de rulesets diferentes não são comparáveis: ${from} vs ${to}. ` +
        `As regras mudaram entre as duas medições, então a diferença não mede ` +
        `trabalho — mede a mudança de regra.`
    )
    this.name = 'IncomparableRulesetsError'
  }
}

/**
 * Fatores por tipo de mudança.
 *
 * Os defaults `added` e `removed` são os âncoras explícitos da AEP §6.5:
 * transação adicionada vale 1, excluída vale 0,4.
 *
 * `changed` é 1 por default **e isso superestima**. A AEP grada de 0,25 a 1,75
 * pela Tabela 6.1, a partir da variação de Effort Complexity — que exige
 * complexidade ciclomática, que este pacote ainda não mede. Contar 1 é a escolha
 * conservadora no sentido de não inventar número, não no sentido de faturar
 * menos, e o resultado avisa sobre isso.
 */
export type ChangeFactors = Record<ChangeType, number>

export const AEP_FACTORS: ChangeFactors = {
  added: 1,
  changed: 1,
  removed: 0.4,
  unchanged: 0,
}

export type DiffOptions = {
  factors?: Partial<ChangeFactors>
  /** rótulos das duas medições, só para o relatório */
  labels?: { from: string; to: string }
}

export type FunctionPointDiff = DiffResult & {
  /** PF ponderado pelos fatores — é o que vira fatura */
  billable: number
  factors: ChangeFactors
  warnings: string[]
}

export function diffCounts(
  from: CountResult,
  to: CountResult,
  options: DiffOptions = {}
): FunctionPointDiff {
  if (from.rulesetVersion !== to.rulesetVersion || from.ruleset !== to.ruleset) {
    throw new IncomparableRulesetsError(
      `${from.ruleset}@${from.rulesetVersion}`,
      `${to.ruleset}@${to.rulesetVersion}`
    )
  }

  const factors = { ...AEP_FACTORS, ...options.factors }
  const before = new Map(from.functions.map((fn) => [fn.id, fn]))
  const after = new Map(to.functions.map((fn) => [fn.id, fn]))

  const entries: DiffEntry[] = []

  for (const [id, fn] of after) {
    const previous = before.get(id)
    if (!previous) {
      entries.push({ function: fn, change: 'added' })
      continue
    }
    entries.push({
      function: fn,
      change: changedBetween(previous, fn) ? 'changed' : 'unchanged',
      previous,
    })
  }

  for (const [id, fn] of before) {
    if (!after.has(id)) entries.push({ function: fn, change: 'removed' })
  }

  const warnings: string[] = []
  if (entries.some((entry) => entry.change === 'changed') && factors.changed === 1) {
    warnings.push(
      'fator de alteração fixo em 1: a AEP grada de 0,25 a 1,75 pela variação de ' +
        'Effort Complexity, que exige complexidade ciclomática — ainda não medida. ' +
        'Funções alteradas estão sendo cobradas pelo valor cheio.'
    )
  }

  return {
    from: options.labels?.from ?? 'anterior',
    to: options.labels?.to ?? 'atual',
    entries: entries.sort(byChangeThenName),
    totals: totalsOf(entries),
    billable: entries.reduce(
      (total, entry) => total + entry.function.points * factors[entry.change],
      0
    ),
    factors,
    warnings,
  }
}

/**
 * O que conta como alteração.
 *
 * Mudança no escopo de implementação (checksum de AST normalizado, §5) **ou** no
 * tamanho funcional. Formatação e comentário não entram: o hash já os ignora.
 *
 * Renomear a rota não aparece aqui porque a identidade é `(verbo, padrão)` — e
 * mover o controller de módulo também não, porque é implementação.
 */
function changedBetween(previous: CountedFunction, current: CountedFunction): boolean {
  if (previous.type !== current.type) return true
  if (previous.det !== current.det || previous.refs !== current.refs) return true
  return (previous.scopeHash ?? '') !== (current.scopeHash ?? '')
}

const ORDER: Record<ChangeType, number> = { added: 0, changed: 1, removed: 2, unchanged: 3 }

const byChangeThenName = (a: DiffEntry, b: DiffEntry) =>
  ORDER[a.change] - ORDER[b.change] || a.function.name.localeCompare(b.function.name)

function totalsOf(entries: DiffEntry[]): DiffResult['totals'] {
  const totals: DiffResult['totals'] = {
    added: { count: 0, points: 0 },
    changed: { count: 0, points: 0 },
    removed: { count: 0, points: 0 },
    unchanged: { count: 0, points: 0 },
  }

  for (const entry of entries) {
    totals[entry.change].count++
    totals[entry.change].points += entry.function.points
  }

  return totals
}
