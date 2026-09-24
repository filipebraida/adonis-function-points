import type { CountResult, FunctionType } from '../types.js'

/**
 * Calibration: measuring the counter's bias against manual counts.
 *
 * This is what turns a percentage of deviation into a usable number. The
 * premise was never exactness against a certified counter — it was
 * **repeatability**, which is what makes calibration possible: systematic error
 * can be calibrated away, variance between human counters cannot.
 *
 * AFP takes the same position on purpose:
 *
 *   "This specification prioritizes repeatability and consistency over
 *    consistency with the IFPUG CPM counting guidelines."  — AFP §6.1
 *
 * What this module does NOT do: apply the factor. Calibrating is a decision for
 * whoever signs the contract, and a factor applied silently would stop the
 * count from being reproducible from the source.
 */

export type CalibrationSample = {
  /** function identity, as it appears in the count */
  function: string
  /** function points from the manual count */
  manual: number
}

export type TypeCalibration = {
  type: FunctionType
  samples: number
  manualPoints: number
  automaticPoints: number
  /**
   * Factor bringing the automatic count towards the manual one:
   * `manual / automatic`.
   *
   * Greater than 1 means the counter **underestimates** this type.
   */
  factor: number
  /** mean absolute deviation, in function points per function */
  meanAbsoluteDeviation: number
  exactMatches: number
}

export type Calibration = {
  byType: TypeCalibration[]
  overall: {
    samples: number
    manualPoints: number
    automaticPoints: number
    /** relative deviation of the total, signed: positive means automatic is larger */
    deviation: number
    exactMatches: number
  }
  /** samples that matched no counted function */
  unmatched: string[]
  warnings: string[]
}

/**
 * Minimum sample size per type for a factor to mean anything.
 *
 * Below this, the "factor" is noise from one or two functions, and using it to
 * correct a count is worse than not correcting at all.
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
        `${calibration.type}: ${calibration.samples} samples, below the minimum of ` +
          `${MIN_SAMPLES_PER_TYPE}. The factor ${calibration.factor} is noise from a ` +
          `handful of functions — do not use it to correct a count.`
      )
    }
  }

  if (unmatched.length > 0) {
    warnings.push(
      `${unmatched.length} samples matched no counted function. Check the identity: ` +
        `it is "VERB /pattern" with parameters written as ":param".`
    )
  }

  const matched = samples.length - unmatched.length
  if (matched > 0 && exactTotal === matched) {
    warnings.push(
      'every sample matched exactly. Check that the manual count was not derived ' +
        'from the automatic one — calibrating against itself measures nothing.'
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
 * Reads samples from CSV: `function,fp` with a header row.
 *
 * Deliberately plain. A metrics analyst exports from a spreadsheet, and
 * demanding JSON would add friction where none is needed.
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

    // header row, or a line with an unreadable value
    if (!Number.isFinite(manual)) {
      if (index > 0 && name !== 'funcao' && name !== 'função') {
        throw new Error(`line ${index + 1}: unreadable function points in "${trimmed}"`)
      }
      continue
    }

    samples.push({ function: name, manual })
  }

  return samples
}
