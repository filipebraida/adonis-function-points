import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import { renderCount, renderExplain } from '../../src/reporters/table.js'
import { appFixturePath } from '../helpers.js'

const withOverride = (overrides: Parameters<typeof analyze>[1]) =>
  analyze(appFixturePath('minimal_flat'), overrides)

const REASON = 'JSON column: 55 fields the user fills, read from the definition in force'

/**
 * counting-decisions §8: when the fields a user fills live in a JSON column
 * whose schema is stored in the database, static analysis has nothing to read
 * and the column counts as 1 DET. The person who knows the form knows the
 * number, so they declare it — in a versioned file, with a justification.
 *
 * The distinction from guessing is the whole point: a declared number is
 * reproducible from a revision and travels with its reason; a number the tool
 * invented would be neither.
 */
test.group('overrides: a declared fact replaces one the analysis cannot read', () => {
  test('the declared DET changes complexity and points', async ({ assert }) => {
    const plain = await withOverride({})
    const declared = await withOverride({ overrides: { Book: { det: 60, reason: REASON } } })

    const before = plain.count.functions.find((f) => f.name === 'Book')!
    const after = declared.count.functions.find((f) => f.name === 'Book')!

    assert.equal(before.complexity, 'low')
    assert.equal(after.det, 60)
    assert.equal(after.complexity, 'average')
    assert.isAbove(after.points, before.points)
  })

  test('the declared RET is honoured too', async ({ assert }) => {
    const { count } = await withOverride({ overrides: { Book: { refs: 6, reason: REASON } } })

    assert.equal(count.functions.find((f) => f.name === 'Book')!.refs, 6)
  })

  test('the justification travels into the rationale', async ({ assert }) => {
    const { count } = await withOverride({ overrides: { Book: { det: 60, reason: REASON } } })
    const book = count.functions.find((f) => f.name === 'Book')!

    assert.lengthOf(book.rationale.overrides!, 1)
    assert.equal(book.rationale.overrides![0].reason, REASON)
    assert.include(book.rationale.overrides![0].by, 'config:overrides.Book')
  })

  test('`fp:explain` prints it, and marks the line as declared', async ({ assert }) => {
    const { count } = await withOverride({ overrides: { Book: { det: 60, reason: REASON } } })
    const text = renderExplain(count.functions.find((f) => f.name === 'Book')!)

    assert.include(text, 'declared by override')
    assert.include(text, REASON)
  })

  /**
   * An override is legitimate where static analysis is blind, and poison as a
   * habit: if it grows, the count comes from a spreadsheet instead of the code.
   */
  test('the count report says how much of the total was declared', async ({ assert }) => {
    const { count } = await withOverride({ overrides: { Book: { det: 60, reason: REASON } } })
    const text = renderCount(count)

    assert.match(text, /Declared by override: 1 function\(s\), \d+ FP \([\d.]+% of the total\)/)
  })

  test('a count with no override says nothing about them', async ({ assert }) => {
    const { count } = await withOverride({})

    assert.notInclude(renderCount(count), 'Declared by override')
  })

  /**
   * A typo in the key would otherwise mean the declaration did nothing and
   * nobody was told — the silent drop this package exists to avoid.
   */
  test('an override naming no function is reported, not ignored', async ({ assert }) => {
    const { count } = await withOverride({
      overrides: { Nonexistent: { det: 9, reason: REASON } },
    })

    assert.isTrue(
      count.confidence.warnings.some((w) => /matched no counted function/.test(w)),
      'a declaration that did nothing has to say so'
    )
  })
})
