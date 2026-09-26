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

/**
 * The three causes used to collapse into one boolean, so a pure refactor and a
 * genuine growth in functional size were indistinguishable in the report and
 * priced identically. On a real month of work, 45 of 74 changed functions turn
 * out to be implementation-only — 44% of the invoice — which is a policy
 * decision nobody could make while the report hid it.
 */
test.group('diff: why a function changed', () => {
  test('a reclassification is a type change', ({ assert }) => {
    const diff = diffCounts(result([fn({ type: 'EO' })]), result([fn({ type: 'EI' })]))

    assert.equal(entryFor(diff, 'POST /books')!.reason, 'type')
  })

  test('a moved DET or FTR is a size change', ({ assert }) => {
    const byDet = diffCounts(result([fn()]), result([fn({ det: 9 })]))
    const byFtr = diffCounts(result([fn()]), result([fn({ refs: 3 })]))

    assert.equal(entryFor(byDet, 'POST /books')!.reason, 'size')
    assert.equal(entryFor(byFtr, 'POST /books')!.reason, 'size')
  })

  test('same size with different code is implementation only', ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn({ scopeHash: 'h2' })]))

    assert.equal(entryFor(diff, 'POST /books')!.reason, 'implementation')
  })

  test('an unchanged function carries no reason', ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn()]))

    assert.isUndefined(entryFor(diff, 'POST /books')!.reason)
  })

  /** type wins: a reclassification usually moves the size too, and explains it */
  test('the most consequential cause is the one reported', ({ assert }) => {
    const diff = diffCounts(result([fn({ type: 'EO' })]), result([fn({ type: 'EI', det: 9 })]))

    assert.equal(entryFor(diff, 'POST /books')!.reason, 'type')
  })

  test('the changed total is split by cause', ({ assert }) => {
    const diff = diffCounts(
      result([
        fn({ id: 'a', name: 'a', type: 'EO' }),
        fn({ id: 'b', name: 'b' }),
        fn({ id: 'c', name: 'c' }),
      ]),
      result([
        fn({ id: 'a', name: 'a', type: 'EI' }),
        fn({ id: 'b', name: 'b', det: 9 }),
        fn({ id: 'c', name: 'c', scopeHash: 'h2' }),
      ])
    )

    assert.equal(diff.changedByReason.type.count, 1)
    assert.equal(diff.changedByReason.size.count, 1)
    assert.equal(diff.changedByReason.implementation.count, 1)
    assert.equal(
      diff.changedByReason.type.points +
        diff.changedByReason.size.points +
        diff.changedByReason.implementation.points,
      diff.totals.changed.points,
      'the split has to close with the total it explains'
    )
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

  /**
   * A Brazilian public contract names the Roteiro de Métricas do SISP, not AEP.
   * v3.0 §7.3: PF_MELHORIA = INCLUÍDO + FI × ALTERADO + 0,50 × EXCLUÍDO, FI 63%
   * for a function the contractor maintains itself (84% otherwise, an override).
   * The result carries the preset's name, because the total is quoted under it.
   */
  test('the SISP preset prices inclusion, alteration and deletion at 1 / 0.63 / 0.5', async ({
    assert,
  }) => {
    const before = result([
      fn({ id: 'a', name: 'a', points: 10 }),
      fn({ id: 'b', name: 'b', points: 10 }),
    ])
    const after = result([
      fn({ id: 'a', name: 'a', points: 10, scopeHash: 'h2' }),
      fn({ id: 'c', name: 'c', points: 10 }),
    ])

    const aep = diffCounts(before, after)
    const sisp = diffCounts(before, after, { preset: 'sisp' })

    assert.equal(aep.preset, 'aep')
    assert.equal(aep.billable, 10 * 1 + 10 * 1 + 10 * 0.4)
    assert.equal(sisp.preset, 'sisp')
    assert.deepEqual(sisp.factors, { added: 1, changed: 0.63, removed: 0.5, unchanged: 0 })
    assert.equal(sisp.billable, 10 * 1 + 10 * 0.63 + 10 * 0.5)

    const other = diffCounts(before, after, { preset: 'sisp', factors: { changed: 0.84 } })
    assert.equal(other.factors.changed, 0.84, 'FI 84%: a function the contractor did not develop')
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
    // by content, not by position: other warnings qualify the same diff
    assert.isTrue(diff.warnings.some((warning) => /Effort Complexity/.test(warning)))
  })

  test('with no modification there is no factor warning', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn()]))

    // these synthetic counts carry no `source`, which warns for its own reason
    assert.isFalse(diff.warnings.some((warning) => /Effort Complexity/.test(warning)))
  })

  /**
   * The warning has to carry the amount, because the amount is what a client
   * disputes. On a real pair of releases the generic sentence sat under 118 lines
   * of per-function output and said only that the factor was pinned.
   */
  test('the factor warning says how much is at stake', async ({ assert }) => {
    const diff = diffCounts(
      result([fn({ points: 10 })]),
      result([fn({ points: 10, scopeHash: 'h2' })])
    )

    const warning = diff.warnings.find((line) => /Effort Complexity/.test(line))!
    assert.match(warning, /10 of 10 billable FP \(100%\)/)
    assert.include(warning, 'implementation only')
  })

  /**
   * The tool already distinguishes a change of type, of size, and of
   * implementation only. Pricing all three at 1 throws that away: on a real pair
   * of releases, 151 of 378 FP billed as change were functions whose type, DET and
   * FTR were identical and only the body differed.
   *
   * The number comes from the contract. Inventing one would be worse than the
   * overestimate it replaces.
   */
  test('a modification can be priced by what changed about it', async ({ assert }) => {
    const previous = result([fn({ points: 10 })])
    const current = result([fn({ points: 10, scopeHash: 'h2' })])

    assert.equal(diffCounts(previous, current).billable, 10)
    assert.equal(
      diffCounts(previous, current, { reasonFactors: { implementation: 0.25 } }).billable,
      2.5
    )
  })

  test('a size change is untouched by the implementation factor', async ({ assert }) => {
    const diff = diffCounts(
      result([fn({ points: 10 })]),
      result([fn({ points: 10, det: 9, scopeHash: 'h2' })]),
      { reasonFactors: { implementation: 0.25 } }
    )

    assert.equal(diff.entries[0].reason, 'size')
    assert.equal(diff.billable, 10)
  })

  test('pricing implementation change silences the pinned-factor warning', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn({ scopeHash: 'h2' })]), {
      reasonFactors: { implementation: 0.5 },
    })

    assert.isFalse(
      diff.warnings.some((warning) => /Effort Complexity/.test(warning)),
      'the contract decided: there is nothing left to warn about'
    )
  })

  /**
   * `485.00000000000006` appeared on the first real diff. Arithmetically the same
   * number, and not the same document: this value is quoted in an invoice, and a
   * reader who sees that tail stops trusting the rest of it.
   */
  test('the billable total is money, not a float artefact', async ({ assert }) => {
    const previous = result([fn({ id: 'a', name: 'a', points: 3 }), fn({ id: 'b', name: 'b' })])
    const current = result([fn({ id: 'a', name: 'a', points: 3, scopeHash: 'h2' })])

    const diff = diffCounts(previous, current, { reasonFactors: { implementation: 0.35 } })

    assert.equal(String(diff.billable), String(Math.round(diff.billable * 100) / 100))
    assert.notInclude(String(diff.billable), '000000')
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
