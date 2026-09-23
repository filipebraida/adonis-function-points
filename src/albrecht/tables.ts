import type { Complexity, FunctionType } from '../types.js'

/**
 * Tabelas de complexidade do IFPUG CPM.
 *
 * São configuráveis de propósito. O estudo de caso do Ligeiro (Pinel, 2012)
 * mostrou que uma diferença de 1 DET — tipicamente a mensagem de confirmação,
 * que nenhuma ferramenta estática enxerga — é suficiente para cruzar a
 * fronteira baixa/média e mudar o valor da função. Calibrar as faixas para a
 * stack analisada é mais honesto que fingir que o viés não existe.
 *
 * Ver docs/research/spike-findings.md.
 */

export type ComplexityTable = {
  /** limites superiores das faixas de RET/FTR: [a, b] => <=a | <=b | resto */
  refBands: [number, number]
  /** limites superiores das faixas de DET */
  detBands: [number, number]
}

/** grade comum: [faixaRef][faixaDet] -> complexidade */
const GRID: Complexity[][] = [
  ['low', 'low', 'average'],
  ['low', 'average', 'high'],
  ['average', 'high', 'high'],
]

export const DEFAULT_TABLES: Record<FunctionType, ComplexityTable> = {
  ILF: { refBands: [1, 5], detBands: [19, 50] },
  EIF: { refBands: [1, 5], detBands: [19, 50] },
  EI: { refBands: [1, 2], detBands: [4, 15] },
  EO: { refBands: [1, 3], detBands: [5, 19] },
  EQ: { refBands: [1, 3], detBands: [5, 19] },
}

export const DEFAULT_WEIGHTS: Record<FunctionType, Record<Complexity, number>> = {
  ILF: { low: 7, average: 10, high: 15 },
  EIF: { low: 5, average: 7, high: 10 },
  EI: { low: 3, average: 4, high: 6 },
  EO: { low: 4, average: 5, high: 7 },
  EQ: { low: 3, average: 4, high: 6 },
}

const bandOf = (value: number, [a, b]: [number, number]): number =>
  value <= a ? 0 : value <= b ? 1 : 2

export function complexityOf(
  type: FunctionType,
  refs: number,
  det: number,
  tables: Record<FunctionType, ComplexityTable> = DEFAULT_TABLES
): Complexity {
  const table = tables[type]
  return GRID[bandOf(refs, table.refBands)][bandOf(det, table.detBands)]
}

export function pointsOf(
  type: FunctionType,
  complexity: Complexity,
  weights: Record<FunctionType, Record<Complexity, number>> = DEFAULT_WEIGHTS
): number {
  return weights[type][complexity]
}
