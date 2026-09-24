import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountedFunction } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

const analyseHooks = () => analyze(appFixturePath('model_hooks'))

const fn = (functions: CountedFunction[], name: string) => functions.find((f) => f.name === name)

/**
 * counting-decisions §3: a hook belongs to the transaction that fired it, and
 * is never a transaction of its own. It crosses no boundary — it fires inside
 * one that already did — and AFP §6.5.3 requires aggregating every path the
 * transaction reaches.
 *
 * The fixture is built around the case where ignoring hooks costs a whole data
 * function rather than a rounding error: `Page` is written ONLY by
 * `Document`'s `@beforeDelete`, so with no transaction reaching it, §6.5.4
 * drops it from the count entirely.
 */
test.group('model hooks: the write inside a hook belongs to the transaction', () => {
  test('a table written only by a hook is counted', async ({ assert }) => {
    const { count } = await analyseHooks()

    const page = fn(count.functions, 'Page')
    assert.exists(page, 'Page is written by a hook, so a transaction does reach it')
    assert.equal(page!.type, 'ILF', 'the application maintains it, through the hook')
  })

  test('the transaction that fires the hook gains the FTR', async ({ assert }) => {
    const { count } = await analyseHooks()

    assert.equal(fn(count.functions, 'DELETE /documents/:param')!.refs, 2, 'Document and Page')
  })

  test('the trace says the step came from a hook', async ({ assert }) => {
    const { inventory } = await analyseHooks()

    const destroy = inventory.entryPoints.find((entry) => entry.name === 'documents.destroy')!
    const behavior = inventory.behaviors.find((b) => b.entryPointId === destroy.id)!

    assert.include(behavior.touches, 'Page')
    assert.isTrue(
      behavior.trace.some((step) => step.by === 'model-hook'),
      'provenance has to name the hook, or the FTR is indefensible'
    )
  })
})

/**
 * The distinction that decides whether this over-counts: Lucid fires instance
 * hooks for `instance.delete()` and does NOT fire them for a query-builder bulk
 * delete. Both land on `method === 'delete'`.
 *
 * Counting more than is there is worse than counting less: an invented FTR
 * moves a complexity band and goes onto an invoice.
 */
test.group('model hooks: bulk operations do not fire them', () => {
  test('a query-builder delete does not reach the hook target', async ({ assert }) => {
    const { inventory } = await analyseHooks()

    const purge = inventory.entryPoints.find((entry) => entry.name === 'documents.purge')!
    const behavior = inventory.behaviors.find((b) => b.entryPointId === purge.id)!

    assert.include(behavior.touches, 'Document')
    assert.notInclude(behavior.touches, 'Page', 'a bulk delete bypasses instance hooks')
  })

  test('so the two transactions differ in FTR', async ({ assert }) => {
    const { count } = await analyseHooks()

    assert.equal(fn(count.functions, 'DELETE /documents/:param')!.refs, 2)
    assert.equal(fn(count.functions, 'POST /documents/purge')!.refs, 1)
  })
})

test.group('model hooks: a hook that touches only its own row', () => {
  test('adds no FTR', async ({ assert }) => {
    const { count } = await analyseHooks()

    assert.equal(fn(count.functions, 'POST /notes')!.refs, 1, 'Note alone')
  })

  test('and invents no unresolved call', async ({ assert }) => {
    const { inventory } = await analyseHooks()

    const store = inventory.entryPoints.find((entry) => entry.name === 'notes.store')!
    const behavior = inventory.behaviors.find((b) => b.entryPointId === store.id)!

    assert.isEmpty(behavior.unresolved)
  })
})
