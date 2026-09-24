import { test } from '@japa/runner'

import { AEP_FACTORS, IncomparableRulesetsError, diffCounts } from '../../src/albrecht/diff.js'
import type { CountResult, CountedFunction } from '../../src/types.js'

/** synthetic count: the diff is arithmetic over identity, so this isolates it */
const fn = (over: Partial<CountedFunction> = {}): CountedFunction => ({
  id: 'tx:POST /books',
  name: 'POST /books',
  module: 'app',
  type: 'EI',
  det: 3,
  refs: 1,
  complexity: 'low',
  points: 3,
  scopeHash: 'h1',
  rationale: { rule: 'afp:6.5.3', detSources: [], refSources: [] },
  ...over,
})

const result = (functions: CountedFunction[], version = '1.0.0'): CountResult => ({
  ruleset: 'afp',
  rulesetVersion: version,
  functions,
  totals: {
    unadjusted: functions.reduce((t, f) => t + f.points, 0),
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

const entryFor = (diff: ReturnType<typeof diffCounts>, name: string) =>
  diff.entries.find((e) => e.function.name === name)

test.group('diff: change classification', () => {
  test('a new function is an addition', async ({ assert }) => {
    const diff = diffCounts(result([]), result([fn()]))
    assert.equal(entryFor(diff, 'POST /books')!.change, 'added')
  })

  test('a function that disappeared is a deletion', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([]))
    assert.equal(entryFor(diff, 'POST /books')!.change, 'removed')
  })

  test('a changed scope is a modification', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn({ scopeHash: 'h2' })]))
    assert.equal(entryFor(diff, 'POST /books')!.change, 'changed')
  })

  test('a changed functional size is a modification', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn({ det: 9, points: 4 })]))
    assert.equal(entryFor(diff, 'POST /books')!.change, 'changed')
  })

  /**
   * The hash is over the normalised AST, with no whitespace and no comments —
   * so running Prettier produces the SAME hash and the function does not change
   * state.
   *
   * Without that, formatting the project would turn into an invoice.
   */
  test('an identical function is not a modification', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn()]))

    assert.equal(entryFor(diff, 'POST /books')!.change, 'unchanged')
    assert.equal(diff.totals.unchanged.count, 1)
  })

  /**
   * counting-decisions §5: identity is `(verb, normalised pattern)`. Moving a
   * controller between modules is refactoring, not a deletion plus an addition
   * — which would bill twice.
   */
  test('moving a controller between modules is not a deletion plus addition', async ({
    assert,
  }) => {
    const diff = diffCounts(
      result([fn({ module: 'catalog' })]),
      result([fn({ module: 'admin/catalog' })])
    )

    assert.lengthOf(diff.entries, 1)
    assert.equal(diff.entries[0].change, 'unchanged')
    assert.equal(diff.totals.added.count, 0)
    assert.equal(diff.totals.removed.count, 0)
  })

  /** Renaming a route parameter does not change the function the user sees. */
  test('renaming a parameter produces no change', async ({ assert }) => {
    const before = fn({ id: 'tx:DELETE /books/:param', name: 'DELETE /books/:param' })
    const diff = diffCounts(result([before]), result([before]))

    assert.equal(diff.entries[0].change, 'unchanged')
  })
})

test.group('diff: factors and billing', () => {
  /** AEP §6.5: added is worth 1, deleted is worth 0.4. */
  test('uses the AEP anchors by default', async ({ assert }) => {
    assert.equal(AEP_FACTORS.added, 1)
    assert.equal(AEP_FACTORS.removed, 0.4)
    assert.equal(AEP_FACTORS.unchanged, 0)
  })

  test('a deleted function is billed at 40%', async ({ assert }) => {
    const diff = diffCounts(result([fn({ points: 10 })]), result([]))
    assert.equal(diff.billable, 4)
  })

  test('an unchanged function does not enter the invoice', async ({ assert }) => {
    const diff = diffCounts(result([fn({ points: 10 })]), result([fn({ points: 10 })]))
    assert.equal(diff.billable, 0)
  })

  test('the factors are overridable, for a contract preset', async ({ assert }) => {
    const diff = diffCounts(result([fn({ points: 10 })]), result([]), {
      factors: { removed: 0.2 },
    })
    assert.equal(diff.billable, 2)
  })

  /**
   * AEP grades the modification factor from 0.25 to 1.75 by the variation in
   * Effort Complexity, which requires cyclomatic complexity — not measured here.
   *
   * Counting 1 overestimates, and the result has to WARN. Billing full value
   * for a one-line change without saying so would be indefensible.
   */
  test('a modification billed at 100% emits a warning', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn({ scopeHash: 'h2' })]))

    assert.equal(diff.billable, 3)
    assert.isNotEmpty(diff.warnings)
    assert.match(diff.warnings[0], /Effort Complexity/)
  })

  test('with no modification there is no factor warning', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn()]))
    assert.isEmpty(diff.warnings)
  })
})

test.group('diff: ruleset', () => {
  /**
   * If the rules changed between the two measurements, the difference does not
   * measure work — it measures the rule change. And the result would go onto an
   * invoice.
   */
  test('refuses to compare different ruleset versions', async ({ assert }) => {
    assert.throws(
      () => diffCounts(result([fn()], '1.0.0'), result([fn()], '2.0.0')),
      IncomparableRulesetsError
    )
  })

  test('the message explains why the comparison is invalid', async ({ assert }) => {
    try {
      diffCounts(result([fn()], '1.0.0'), result([fn()], '1.1.0'))
      assert.fail('should have thrown')
    } catch (error) {
      assert.match((error as Error).message, /measures the rule change/)
    }
  })

  test('the same version compares normally', async ({ assert }) => {
    const diff = diffCounts(result([fn()], '1.0.0'), result([fn()], '1.0.0'))
    assert.lengthOf(diff.entries, 1)
  })
})
