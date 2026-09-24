import { test } from '@japa/runner'

import { CoverageTooLowError, analyze } from '../../src/pipeline.js'
import { diffCounts } from '../../src/albrecht/diff.js'
import { renderCount, renderDiff, renderExplain } from '../../src/reporters/table.js'
import { appFixturePath } from '../helpers.js'

test.group('pipeline', () => {
  test('produces inventory and count in one pass', async ({ assert }) => {
    const { inventory, count } = await analyze(appFixturePath('minimal_flat'))

    assert.equal(inventory.version, 1)
    assert.isNotEmpty(inventory.dataStores)
    assert.isNotEmpty(inventory.entryPoints)
    assert.isAbove(count.totals.unadjusted, 0)
  })

  test('the inventory records which framework the count was made on', async ({ assert }) => {
    const { inventory } = await analyze(appFixturePath('minimal_flat'))

    assert.equal(inventory.framework.core, 7)
    assert.equal(inventory.framework.orm, 'lucid')
  })

  /**
   * A number resting on poor tracing should not become an invoice. The package
   * prefers to fail over emitting something that merely looks right.
   */
  test('fails when coverage falls below the minimum', async ({ assert }) => {
    await assert.rejects(
      () => analyze(appFixturePath('minimal_flat'), { minCoverage: 1.01 }),
      CoverageTooLowError
    )
  })

  test('the message says what to do, not just that it failed', async ({ assert }) => {
    try {
      await analyze(appFixturePath('minimal_flat'), { minCoverage: 1.01 })
      assert.fail('should have failed')
    } catch (error) {
      assert.match((error as Error).message, /fp:inventory/)
    }
  })

  test('with no minimum configured, it does not block', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('edges_boundary'))
    assert.isAbove(count.totals.unadjusted, 0)
  })

  /**
   * The three invariant apps go through the whole pipeline with the same total
   * — the golden invariant holding end to end, not only inside the engine.
   */
  test('the three invariant apps give the same total through the pipeline', async ({ assert }) => {
    const totals = await Promise.all(
      ['minimal_flat', 'minimal_modular', 'minimal_nogen'].map(async (name) => {
        const { count } = await analyze(appFixturePath(name))
        return count.totals.unadjusted
      })
    )

    assert.deepEqual(totals, [totals[0], totals[0], totals[0]])
  })
})

test.group('report: count', () => {
  test('shows the total, the ruleset and the functions', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const text = renderCount(count)

    assert.match(text, /Unadjusted count: \d+ FP/)
    assert.include(text, 'afp@')
    assert.include(text, 'POST /books')
  })

  /**
   * AFP §6.5.3 requires that what was missing appears in the report. A total
   * with no confidence beside it invites being treated as exact.
   */
  test('confidence appears beside the number when there is something to report', async ({
    assert,
  }) => {
    const { count } = await analyze(appFixturePath('edges_boundary'))
    const text = renderCount(count)

    assert.include(text, 'Confidence:')
    assert.include(text, 'UserSession', 'the technical exclusion must be visible')
  })
})

test.group('report: explain', () => {
  /**
   * `fp:explain` is what supports a dispute. It has to show the rule from the
   * standard, the origin of each DET and each FTR, and the path walked.
   */
  test('shows the rule, the DET origins and the FTR origins', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const text = renderExplain(count.functions.find((f) => f.name === 'POST /books')!)

    assert.match(text, /Rule applied: afp:/)
    assert.include(text, 'DET =')
    assert.include(text, 'FTR =')
    assert.include(text, 'validator:')
  })

  test('shows the path walked, with who resolved each step', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const text = renderExplain(count.functions.find((f) => f.name === 'POST /books')!)

    assert.include(text, 'Path walked:')
    assert.include(text, 'action-object', 'the trace must say which strategy resolved it')
    assert.include(text, '[writes]', 'and where the write happens')
  })

  test('a data function shows RET, not FTR', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const text = renderExplain(count.functions.find((f) => f.name === 'Book')!)

    assert.include(text, 'RET =')
    assert.notInclude(text, 'FTR =')
  })
})

test.group('report: diff', () => {
  const BILLABLE = 'Billable FP'

  test('shows the billable total and details only what changed', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const reduced = { ...count, functions: count.functions.slice(1) }

    const text = renderDiff(diffCounts(count, reduced))

    assert.match(text, /Billable FP: [\d.]+/)
    assert.include(text, 'removed')

    // the SUMMARY shows how many stayed unchanged — that is useful information;
    // the DETAIL lists only what changed, otherwise a small release is a wall
    const cut = text.indexOf(BILLABLE)
    assert.isAbove(cut, -1, 'the billable line anchors this assertion')
    assert.notInclude(text.slice(cut), 'unchanged')
    assert.include(text.slice(0, cut), 'unchanged')
  })

  test('the warning about the modification factor appears in the text', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const modified = {
      ...count,
      functions: count.functions.map((fn) => ({ ...fn, scopeHash: 'other' })),
    }

    const text = renderDiff(diffCounts(count, modified))
    assert.match(text, /Warning:.*Effort Complexity/s)
  })
})
