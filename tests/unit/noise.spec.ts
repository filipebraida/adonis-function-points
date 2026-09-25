import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import { appFixturePath } from '../helpers.js'

const analyseNoisy = () => analyze(appFixturePath('noisy_handler'))

const unresolvedOf = (
  inventory: Awaited<ReturnType<typeof analyze>>['inventory'],
  name: string
) => {
  const entry = inventory.entryPoints.find((e) => e.name === name)!
  return inventory.behaviors.find((b) => b.entryPointId === entry.id)!.unresolved
}

/**
 * Coverage is all-or-nothing per transaction — one unresolved call sinks the
 * whole thing — so reporting a `Map.get()` costs a transaction, not a line. On
 * a production application that dragged the metric down to 53% while the data
 * tracing was far better than that, and a gate that fails spuriously teaches
 * people to switch the gate off.
 */
test.group('noise: what must not count against coverage', () => {
  test('a method on a Map held in a field is not reported', async ({ assert }) => {
    const { inventory } = await analyseNoisy()

    assert.isEmpty(
      unresolvedOf(inventory, 'notes.store').filter((u) => u.expression.includes('names')),
      'the receiver is `new Map()`, which no repository is'
    )
  })

  test('a framework service reached through an app alias is not reported', async ({ assert }) => {
    const { inventory } = await analyseNoisy()

    assert.isEmpty(
      unresolvedOf(inventory, 'notes.store').filter((u) => u.expression.includes('env'))
    )
  })

  /**
   * Three shapes that the first version of the filter missed, each found by
   * running against a production application rather than reasoned about.
   */
  test('a Map handed in through the constructor counts as native too', async ({ assert }) => {
    const { inventory } = await analyseNoisy()

    assert.isEmpty(
      unresolvedOf(inventory, 'notes.store').filter((u) => u.expression.includes('lookups')),
      'reading only class properties missed every Map passed to the constructor'
    )
  })

  test('a framework service held as a field is not reported', async ({ assert }) => {
    const { inventory } = await analyseNoisy()

    assert.isEmpty(
      unresolvedOf(inventory, 'notes.store').filter((u) => u.expression.includes('logger'))
    )
  })

  test('a Promise method at the end of a chain is not reported', async ({ assert }) => {
    const { inventory } = await analyseNoisy()

    assert.isEmpty(
      unresolvedOf(inventory, 'notes.store').filter((u) => u.expression.includes('catch')),
      'the reported expression is the whole chain, so the method seen is `catch`'
    )
  })

  test('the noisy transaction ends fully covered', async ({ assert }) => {
    const { inventory } = await analyseNoisy()

    assert.isEmpty(unresolvedOf(inventory, 'notes.store'))
  })

  /**
   * The control, and the reason the filter decides by what the RECEIVER IS
   * rather than by the method name: `get`, `find` and `has` belong to a Map and
   * to a repository alike. Silencing by name would buy coverage with hidden
   * gaps, which is the defect this package exists to avoid.
   */
  test('a real gap on an application symbol is still reported', async ({ assert }) => {
    const { inventory } = await analyseNoisy()
    const gaps = unresolvedOf(inventory, 'notes.archive')

    assert.isNotEmpty(gaps, 'this.audit.record cannot be followed and must stay visible')
    assert.isTrue(gaps.some((u) => u.expression.includes('audit')))
  })

  test('and the transaction it sits in stays uncovered', async ({ assert }) => {
    const { inventory } = await analyseNoisy()

    assert.isBelow(inventory.coverage.ratio, 1, 'a real gap has to cost coverage')
  })
})

test.group('noise: iteration and chained calls', () => {
  test('an iteration method with a callback is not reported', async ({ assert }) => {
    const { inventory } = await analyseNoisy()
    const gaps = unresolvedOf(inventory, 'notes.refresh')

    assert.isEmpty(
      gaps.filter((u) => u.expression.includes('some') || u.expression.includes('map')),
      '`rules.some((r) => …)` is a predicate over a list, not a query'
    )
  })

  test('a resolver cannot claim an iteration call', async ({ assert }) => {
    const { inventory } = await analyseNoisy()
    const gaps = unresolvedOf(inventory, 'notes.refresh')

    /**
     * The rest of this filter is consulted only after every resolver declines.
     * `LABELS.map(cb)` never got that far: `static-service` recognised the
     * shape, resolved the enum module and reported a missing `map` in it. So
     * this shape has to be refused BEFORE the resolvers, not after.
     */
    assert.isEmpty(gaps.filter((u) => u.expression.includes('labels')))
  })

  test('`toISOString` is not reported', async ({ assert }) => {
    const { inventory } = await analyseNoisy()

    assert.isEmpty(
      unresolvedOf(inventory, 'notes.refresh').filter((u) => u.expression.includes('toISOString'))
    )
  })

  test('a call on the result of a call is charged to the inner call only', async ({ assert }) => {
    const { inventory } = await analyseNoisy()
    const gaps = unresolvedOf(inventory, 'notes.refresh').map((u) => u.expression)

    assert.isEmpty(
      gaps.filter((expression) => expression.includes('waitResult')),
      'the receiver is a value this body already holds'
    )
    assert.isNotEmpty(
      gaps.filter((expression) => expression.includes('enqueue')),
      'the unknown is still reported — once, where it is actually unknown'
    )
  })
})

/**
 * The hard invariant of this filter: unresolved calls feed coverage and never
 * the count. If silencing one moves a function point, the filter removed
 * something that was a data access.
 */
test.group('noise: the count must not move', () => {
  test('the data access surrounded by noise is still found', async ({ assert }) => {
    const { count, inventory } = await analyseNoisy()

    const store = inventory.entryPoints.find((e) => e.name === 'notes.store')!
    const behavior = inventory.behaviors.find((b) => b.entryPointId === store.id)!

    assert.include(behavior.touches, 'Note')
    assert.isTrue(behavior.writes, 'Note.create() is a write, whatever surrounds it')
    assert.equal(count.functions.find((f) => f.name === 'POST /notes')!.type, 'EI')
  })

  test('the store reached only through noisy code is still counted', async ({ assert }) => {
    const { count } = await analyseNoisy()

    assert.exists(count.functions.find((f) => f.name === 'Note'))
  })
})
