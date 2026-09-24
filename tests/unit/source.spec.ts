import { test } from '@japa/runner'

import { IncomparableSourcesError, diffCounts } from '../../src/albrecht/diff.js'
import { describeSource } from '../../src/inventory/source.js'
import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

const countLike = (source?: CountResult['source']): CountResult => ({
  ruleset: 'afp',
  rulesetVersion: '1.0.0',
  source,
  functions: [],
  totals: {
    unadjusted: 0,
    byType: {
      ILF: { count: 0, points: 0 },
      EIF: { count: 0, points: 0 },
      EI: { count: 0, points: 0 },
      EO: { count: 0, points: 0 },
      EQ: { count: 0, points: 0 },
    },
    byModule: {},
  },
  confidence: { unresolvedCalls: 0, entryPointsWithoutHandler: 0, warnings: [] },
})

const sourceOf = (over: Partial<NonNullable<CountResult['source']>> = {}) => ({
  app: 'shop',
  revision: 'a'.repeat(40),
  countedAt: '2026-09-24T00:00:00.000Z',
  config: null,
  ...over,
})

/**
 * A saved count used to say which RULESET produced it and nothing about its
 * subject. Two such files compare cleanly and mean nothing — the same
 * application a month apart is indistinguishable from a defect in the counter,
 * which is a mistake that was actually made here before this existed.
 */
test.group('source: a count says what it counted', () => {
  test('the count carries the application identity', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))

    assert.equal(count.source!.app, 'minimal-flat', 'the package.json name, not a path')
    assert.notInclude(count.source!.app, '/', 'an absolute path would leak the machine layout')
  })

  test('it records the configuration that shaped it', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'), { configFile: '/x/config.ts' })
    assert.equal(count.source!.config, '/x/config.ts')
  })

  test('and a timestamp', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    assert.match(count.source!.countedAt, /^\d{4}-\d{2}-\d{2}T/)
  })

  test('a root outside any repository still produces a source', ({ assert }) => {
    const source = describeSource('/', null)

    assert.isString(source.app)
    assert.isString(source.countedAt)
  })
})

test.group('source: what the diff refuses and what it qualifies', () => {
  test('refuses two counts of different applications', ({ assert }) => {
    assert.throws(
      () =>
        diffCounts(countLike(sourceOf({ app: 'shop' })), countLike(sourceOf({ app: 'billing' }))),
      IncomparableSourcesError
    )
  })

  test('the message says the difference would not measure work', ({ assert }) => {
    try {
      diffCounts(countLike(sourceOf({ app: 'a' })), countLike(sourceOf({ app: 'b' })))
      assert.fail('should have thrown')
    } catch (error) {
      assert.match((error as Error).message, /would not measure work/)
    }
  })

  /**
   * A count taken over uncommitted changes cannot be reproduced from any
   * revision. It still compares — refusing would be unhelpful — but whoever
   * receives the invoice is entitled to know before paying it.
   */
  test('warns when either side was counted over a dirty tree', ({ assert }) => {
    const diff = diffCounts(countLike(sourceOf()), countLike(sourceOf({ dirty: true })))

    assert.isTrue(diff.warnings.some((w) => /uncommitted changes/.test(w)))
  })

  test('warns when a count carries no source at all', ({ assert }) => {
    const diff = diffCounts(countLike(), countLike(sourceOf()))

    assert.isTrue(diff.warnings.some((w) => /records no source/.test(w)))
  })

  test('warns when both sides are the same revision', ({ assert }) => {
    const diff = diffCounts(countLike(sourceOf()), countLike(sourceOf()))

    assert.isTrue(diff.warnings.some((w) => /same revision/.test(w)))
  })

  test('says nothing when the two revisions differ', ({ assert }) => {
    const diff = diffCounts(
      countLike(sourceOf()),
      countLike(sourceOf({ revision: 'b'.repeat(40) }))
    )

    assert.isFalse(diff.warnings.some((w) => /same revision/.test(w)))
  })
})
