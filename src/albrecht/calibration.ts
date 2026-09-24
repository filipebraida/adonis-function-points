import type { CountResult, FunctionType } from '../types.js'

/**
 * Calibração: medir o viés do contador contra contagem manual.
 *
 * É a peça que transforma "5 a 15% de desvio" em número utilizável. A premissa
 * do projeto nunca foi exatidão contra um contador certificado — foi
 * **repetibilidade**, que permite calibrar:
 *
 *   erro sistemático se calibra; variância entre contadores, não.
 *
 * O AFP assume a mesma postura de propósito:
 *
 *   "This specification prioritizes repeatability and consistency over
 *    consistency with the IFPUG CPM counting guidelines."  — AFP §6.1
 *
 * O que este módulo NÃO faz: aplicar o fator automaticamente. Calibrar é
 * decisão de quem assina o contrato, e um fator aplicado em silêncio faria a
 * contagem deixar de ser reproduzível a partir do código.
 */

export type CalibrationSample = {
  /** identidade da função, como aparece na contagem */
  function: string
  /** PF apurados por contagem manual */
  manual: number
}

export type TypeCalibration = {
  type: FunctionType
  samples: number
  manualPoints: number
  automaticPoints: number
  /**
   * Fator que aproximaria o automático do manual: `manual / automático`.
   *
   * Maior que 1 significa que o contador **subestima** este tipo.
   */
  factor: number
  /** desvio médio absoluto, em PF por função */
  meanAbsoluteDeviation: number
  exactMatches: number
}

export type Calibration = {
  byType: TypeCalibration[]
  overall: {
    samples: number
    manualPoints: number
    automaticPoints: number
    /** desvio relativo do total, com sinal: positivo = automático maior */
    deviation: number
    exactMatches: number
  }
  /** amostras que não casaram com nenhuma função contada */
  unmatched: string[]
  warnings: string[]
}

/**
 * Amostra mínima por tipo para que um fator signifique algo.
 *
 * Abaixo disso o "fator" é ruído de uma ou duas funções, e usá-lo para
 * corrigir contagem é pior que não corrigir. O número vem da recomendação
 * prática de calibrar contra 10 a 20 demandas.
 */
const MIN_SAMPLES_PER_TYPE = 10

export function calibrate(result: CountResult, samples: CalibrationSample[]): Calibration {
  const byIdentity = new Map(result.functions.map((fn) => [fn.name, fn]))

  const grouped = new Map<
    FunctionType,
    { manual: number; automatic: number; deviations: number[]; exact: number }
  >()
  const unmatched: string[] = []

  let manualTotal = 0
  let automaticTotal = 0
  let exactTotal = 0

  for (const sample of samples) {
    const counted = byIdentity.get(sample.function)
    if (!counted) {
      unmatched.push(sample.function)
      continue
    }

    const bucket = grouped.get(counted.type) ?? {
      manual: 0,
      automatic: 0,
      deviations: [],
      exact: 0,
    }

    bucket.manual += sample.manual
    bucket.automatic += counted.points
    bucket.deviations.push(Math.abs(counted.points - sample.manual))
    if (counted.points === sample.manual) bucket.exact++
    grouped.set(counted.type, bucket)

    manualTotal += sample.manual
    automaticTotal += counted.points
    if (counted.points === sample.manual) exactTotal++
  }

  const byType: TypeCalibration[] = [...grouped.entries()]
    .map(([type, bucket]) => ({
      type,
      samples: bucket.deviations.length,
      manualPoints: bucket.manual,
      automaticPoints: bucket.automatic,
      factor: bucket.automatic === 0 ? 1 : round(bucket.manual / bucket.automatic),
      meanAbsoluteDeviation: round(
        bucket.deviations.reduce((total, value) => total + value, 0) / bucket.deviations.length
      ),
      exactMatches: bucket.exact,
    }))
    .sort((a, b) => a.type.localeCompare(b.type))

  const warnings: string[] = []

  for (const calibration of byType) {
    if (calibration.samples < MIN_SAMPLES_PER_TYPE) {
      warnings.push(
        `${calibration.type}: ${calibration.samples} amostras, abaixo do mínimo de ` +
          `${MIN_SAMPLES_PER_TYPE}. O fator ${calibration.factor} é ruído de poucas ` +
          `funções — não use para corrigir contagem.`
      )
    }
  }

  if (unmatched.length > 0) {
    warnings.push(
      `${unmatched.length} amostras não casaram com nenhuma função contada. ` +
        `Confira a identidade: ela é "VERBO /padrão" com parâmetros como ":param".`
    )
  }

  const matched = samples.length - unmatched.length
  if (matched > 0 && exactTotal === matched) {
    warnings.push(
      'todas as amostras bateram exatamente. Confira se a contagem manual não foi ' +
        'derivada da automática — calibrar contra si mesmo não mede nada.'
    )
  }

  return {
    byType,
    overall: {
      samples: matched,
      manualPoints: manualTotal,
      automaticPoints: automaticTotal,
      deviation: manualTotal === 0 ? 0 : round((automaticTotal - manualTotal) / manualTotal),
      exactMatches: exactTotal,
    },
    unmatched,
    warnings,
  }
}

const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * Lê amostras de CSV: `funcao,pf` com cabeçalho.
 *
 * Formato deliberadamente pobre. O contador de métricas vai exportar de uma
 * planilha, e exigir JSON criaria atrito onde não precisa.
 */
export function parseSamples(csv: string): CalibrationSample[] {
  const samples: CalibrationSample[] = []

  for (const [index, line] of csv.split(/\r?\n/).entries()) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const separator = trimmed.lastIndexOf(',')
    if (separator === -1) continue

    const name = trimmed.slice(0, separator).trim().replace(/^"|"$/g, '')
    const manual = Number(trimmed.slice(separator + 1).trim())

    // cabeçalho, ou linha com PF ilegível
    if (!Number.isFinite(manual)) {
      if (index > 0 && name !== 'funcao' && name !== 'função') {
        throw new Error(`linha ${index + 1}: PF ilegível em "${trimmed}"`)
      }
      continue
    }

    samples.push({ function: name, manual })
  }

  return samples
}
