import { test } from '@japa/runner'

import { DEFAULT_WEIGHTS, complexityOf, pointsOf } from '../../src/albrecht/tables.js'

/**
 * Cases taken from the case study in Vazquez, Simões and Albert (2011), the
 * same reference used by the Ligeiro dissertation.
 */
test.group('IFPUG complexity tables', () => {
  test('an ILF with 1 RET and few DETs is low', ({ assert }) => {
    assert.equal(complexityOf('ILF', 1, 3), 'low')
    assert.equal(pointsOf('ILF', 'low'), 7)
  })

  test('an EIF is worth less than an ILF at the same complexity', ({ assert }) => {
    assert.isBelow(pointsOf('EIF', 'low'), pointsOf('ILF', 'low'))
    assert.equal(pointsOf('EIF', 'low'), 5)
  })

  test('an EI with 2 FTRs and 5 DETs is average', ({ assert }) => {
    assert.equal(complexityOf('EI', 2, 5), 'average')
    assert.equal(pointsOf('EI', 'average'), 4)
  })

  test('an EI with 2 FTRs and 4 DETs is still low', ({ assert }) => {
    assert.equal(complexityOf('EI', 2, 4), 'low')
  })

  test('an EO has wider DET bands than an EI', ({ assert }) => {
    // 5 DETs: average for an EI, low for an EO
    assert.equal(complexityOf('EI', 2, 5), 'average')
    assert.equal(complexityOf('EO', 2, 5), 'low')
  })

  test('an EO is worth more than an EI at the same complexity', ({ assert }) => {
    assert.isAbove(pointsOf('EO', 'low'), pointsOf('EI', 'low'))
  })

  /**
   * Why configurable tables are justified: the confirmation message — invisible
   * to static analysis — is 1 DET under IFPUG, and that alone is enough to
   * cross a band and move a function from 4 points to 3.
   */
  test('one DET less can change the band and the value', ({ assert }) => {
    const withMessage = complexityOf('EI', 2, 5)
    const withoutMessage = complexityOf('EI', 2, 4)
    assert.notEqual(withMessage, withoutMessage)
    assert.notEqual(pointsOf('EI', withMessage), pointsOf('EI', withoutMessage))
  })

  test('every type has a weight for every complexity', ({ assert }) => {
    for (const type of ['ILF', 'EIF', 'EI', 'EO', 'EQ'] as const)
      for (const cx of ['low', 'average', 'high'] as const)
        assert.isNumber(DEFAULT_WEIGHTS[type][cx])
  })
})
