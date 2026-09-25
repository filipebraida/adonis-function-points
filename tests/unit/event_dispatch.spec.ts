import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectEventBindings } from '../../src/inventory/sources/event_bindings.js'
import { analyze } from '../../src/pipeline.js'
import { appFixturePath, posix } from '../helpers.js'

/**
 * A dispatch is followed as part of the SAME transaction: the user clicks and
 * the effect happens, and AFP §6.5.3 requires aggregating every path the
 * transaction reaches. The emitter is how it gets there, not a boundary.
 *
 * Left unfollowed this failed twice over: the call was reported as an unknown —
 * `dispatch` comes from `BaseEvent`, so the event class has no body — and every
 * read and write inside the listener went uncounted.
 */
test.group('event dispatch: the write is in the listener', () => {
  test('the binding is read, not inferred from a name', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('event_listener'))
    const bindings = collectEventBindings(app)

    const placed = [...bindings].find(([file]) => file.endsWith('order_placed.ts'))
    assert.isDefined(placed, '`emitter.on(events.OrderPlaced, [listeners.ReserveStock])`')
    assert.include(posix(placed![1][0].file), 'listeners/reserve_stock.ts')
    assert.equal(placed![1][0].member, 'handle')
  })

  test('a binding that names the method is followed to that method', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('event_listener'))
    const bindings = collectEventBindings(app)

    const ready = [...bindings].find(([file]) => file.endsWith('shipment_ready.ts'))

    /**
     * `[[listeners.NotifyCarrier, 'onShipment']]`. Taking `handle` on faith
     * would look for a body that is not the one bound.
     */
    assert.isDefined(ready)
    assert.equal(ready![1][0].member, 'onShipment')
  })

  test('a store written only by a listener is reached', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('event_listener'))

    const store = count.functions.find((f) => f.name === 'POST /orders')!
    assert.deepEqual(store.rationale.refSources, ['reaches:Order', 'reaches:StockMovement'])
  })

  test('the direct form is not swallowed by `job-dispatch`', async ({ assert }) => {
    const { count, inventory } = await analyze(appFixturePath('event_listener'))

    /**
     * `ShipmentReady.dispatch(id)` is `Identifier.method(args)`, the shape
     * `job-dispatch` matches. It would resolve the event class, find no
     * `handle`, and report `dispatch` as an unknown.
     */
    assert.equal(inventory.coverage.unresolvedCalls, 0)
    assert.deepEqual(
      count.functions.find((f) => f.name === 'POST /orders/:param/ship')!.rationale.refSources,
      ['reaches:CarrierNotice']
    )
  })

  test('the listener is not an entry point of its own', async ({ assert }) => {
    const { inventory } = await analyze(appFixturePath('event_listener'))

    assert.lengthOf(
      inventory.entryPoints,
      2,
      'the listener is a path of a transaction, not a transaction'
    )
  })

  test('an application with no bindings is unaffected', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))

    assert.equal(collectEventBindings(app).size, 0)
  })
})
