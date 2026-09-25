import { test } from '@japa/runner'

import { IncomparableSourcesError, diffCounts } from '../../src/albrecht/diff.js'
import { describeSource } from '../../src/inventory/source.js'
import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath, posix } from '../helpers.js'

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

  /**
   * Relative to the application, for the same reason `app` is a name: an absolute
   * path says where the machine keeps its files, and this artefact goes into a
   * ledger and to whoever receives the invoice. A config outside the root keeps its
   * `../` prefix, which describes where it is without naming a home directory.
   */
  test('it records the configuration that shaped it, relative to the app', async ({ assert }) => {
    const root = appFixturePath('minimal_flat')
    const { count } = await analyze(root, { configFile: `${root}/config/fp.ts` })

    assert.equal(posix(count.source!.config!), 'config/fp.ts')
  })

  test('a config outside the root leaks no absolute prefix', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'), { configFile: '/x/config.ts' })

    /**
     * The `../` prefix reveals how deep the root is and nothing about where it
     * lives, which is the honest description of a file outside the application.
     */
    assert.isTrue(count.source!.config!.startsWith('..'))
    assert.isFalse(count.source!.config!.startsWith('/'), 'no absolute prefix')
  })

  /**
   * Has teeth on any platform: the input is deliberately mixed, so a product that
   * merely stored what it was given would fail here on Linux too.
   */
  test('the recorded config path is canonical whatever the caller passed', async ({ assert }) => {
    const root = appFixturePath('minimal_flat')
    const { count } = await analyze(root, {
      configFile: `${root}\\config/function_points.ts`,
    })

    assert.equal(posix(count.source!.config!), 'config/function_points.ts')
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

/**
 * `CountSource.app` is documented as never being the absolute path, because that
 * says where the machine keeps its files and travels with every artefact sent
 * anywhere. The rule was stated on one field and applied to one field: a production
 * count carried 858 absolute paths in its traces and an inventory carried 2036
 * across ten fields — and those artefacts are what a ledger stores.
 */
test.group('emitted artefacts carry no absolute path', () => {
  const home = process.env.HOME ?? '/home'

  test('the count has none', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))

    assert.notInclude(JSON.stringify(count), home)
    assert.isTrue(
      count.functions.some((fn) => (fn.rationale.trace ?? []).length > 0),
      'a count with no trace would pass this vacuously'
    )
  })

  test('the inventory has none', async ({ assert }) => {
    const { inventory } = await analyze(appFixturePath('minimal_flat'))

    assert.notInclude(JSON.stringify(inventory), home)
    assert.isNotEmpty(inventory.dataStores)
    assert.isNotEmpty(inventory.behaviors)
  })

  test('the paths are relative to the application, and still usable', async ({ assert }) => {
    const { inventory } = await analyze(appFixturePath('minimal_flat'))

    const book = inventory.dataStores.find((store) => store.name === 'Book')!
    assert.equal(posix(book.provenance.file), 'app/models/book.ts')
    assert.include(posix(book.id), 'app/models/book.ts#Book')
  })
})
