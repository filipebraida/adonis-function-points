import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import { calibrate, parseSamples } from '../../src/albrecht/calibration.js'
import { appFixturePath } from '../helpers.js'

/**
 * The Vazquez benchmark doubles as the calibration set: 10 functions with a
 * published manual value. Calibrating against it measures the counter's real
 * bias, rather than against numbers we produced ourselves.
 */
const VAZQUEZ_SAMPLES = `# function,fp — reference from Vazquez et al. (2011)
function,fp
Pessoa,5
Justificativa,7
Apontamento,7
GET /apontamentos,3
POST /apontamentos,3
PUT /apontamentos/:param,4
DELETE /apontamentos/:param,3
POST /apontamentos/justificar,4
GET /presenca,5
GET /presenca/relatorio,5
`

const calibrateVazquez = async () => {
  const { count } = await analyze(appFixturePath('vazquez'), {
    boundary: { externallyMaintained: ['Pessoa'] },
  })
  return calibrate(count, parseSamples(VAZQUEZ_SAMPLES))
}

test.group('calibration: reading the samples', () => {
  test('reads a CSV with a header and a comment', async ({ assert }) => {
    const samples = parseSamples(VAZQUEZ_SAMPLES)

    assert.lengthOf(samples, 10)
    assert.deepEqual(samples[0], { function: 'Pessoa', manual: 5 })
  })

  /** A function name may contain a comma, and the FP value is the last field. */
  test('splits on the last field, not the first', async ({ assert }) => {
    const samples = parseSamples('function,fp\n"GET /a,b",4\n')
    assert.deepEqual(samples, [{ function: 'GET /a,b', manual: 4 }])
  })

  test('refuses a line with an unreadable FP value instead of ignoring it', async ({ assert }) => {
    assert.throws(
      () => parseSamples('function,fp\nPOST /books,abc\n'),
      /unreadable function points/
    )
  })

  test('ignores empty lines', async ({ assert }) => {
    assert.lengthOf(parseSamples('function,fp\n\nPessoa,5\n\n'), 1)
  })
})

test.group('calibration: measured bias', () => {
  test('measures the deviation of the total against the manual count', async ({ assert }) => {
    const calibration = await calibrateVazquez()

    assert.equal(calibration.overall.samples, 10)
    assert.equal(calibration.overall.manualPoints, 46)
    assert.equal(calibration.overall.automaticPoints, 46)
    assert.equal(calibration.overall.deviation, 0)
  })

  /**
   * The total matches, but two functions diverge and cancel out. Calibration by
   * TYPE is what reveals that — and bias is corrected per type.
   */
  test('the per-type factor reveals the bias the total hides', async ({ assert }) => {
    const calibration = await calibrateVazquez()

    const eo = calibration.byType.find((item) => item.type === 'EO')!
    const ei = calibration.byType.find((item) => item.type === 'EI')!

    // EO overestimates (an EQ collapsed into an EO weighs more), EI
    // underestimates (the message DET)
    assert.isBelow(eo.factor, 1, 'EO should be overestimated')
    assert.isAbove(ei.factor, 1, 'EI should be underestimated')
  })

  test('counts how many functions match exactly', async ({ assert }) => {
    const calibration = await calibrateVazquez()
    assert.equal(calibration.overall.exactMatches, 8)
  })

  test('the data functions carry no bias at all', async ({ assert }) => {
    const calibration = await calibrateVazquez()

    for (const type of ['ILF', 'EIF'] as const) {
      const item = calibration.byType.find((entry) => entry.type === type)
      if (!item) continue
      assert.equal(item.factor, 1, `${type} should match exactly`)
      assert.equal(item.meanAbsoluteDeviation, 0)
    }
  })
})

test.group('calibration: guards against a misleading number', () => {
  /**
   * A "factor" drawn from two functions is noise. Using it to correct a count
   * is worse than not correcting — and the number would go onto an invoice.
   */
  test('warns when the sample is too small for the factor to mean anything', async ({ assert }) => {
    const calibration = await calibrateVazquez()

    assert.isNotEmpty(calibration.warnings)
    assert.isTrue(
      calibration.warnings.some((w) => /below the minimum/.test(w)),
      'a 10-function sample has few cases per type'
    )
  })

  test('an unmatched sample is reported, not discarded', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('vazquez'))
    const calibration = calibrate(count, [
      { function: 'POST /nonexistent', manual: 4 },
      { function: 'Apontamento', manual: 7 },
    ])

    assert.deepEqual(calibration.unmatched, ['POST /nonexistent'])
    assert.isTrue(calibration.warnings.some((w) => /matched no counted function/.test(w)))
  })

  /**
   * If everything matches exactly, the likeliest explanation is not that the
   * counter is perfect — it is that the "manual count" came from the automatic
   * one.
   */
  test('is suspicious when everything matches exactly', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const calibration = calibrate(
      count,
      count.functions.map((fn) => ({ function: fn.name, manual: fn.points }))
    )

    assert.isTrue(
      calibration.warnings.some((w) => /calibrating against itself/.test(w)),
      'a 100% match should raise suspicion, not celebration'
    )
  })

  test('does not apply the factor automatically', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('vazquez'), {
      boundary: { externallyMaintained: ['Pessoa'] },
    })
    const before = count.totals.unadjusted

    calibrate(count, parseSamples(VAZQUEZ_SAMPLES))

    assert.equal(
      count.totals.unadjusted,
      before,
      'calibrating is a decision for whoever signs the contract, not a side effect'
    )
  })
})
