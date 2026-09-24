import { test } from '@japa/runner'
import path from 'node:path'

import { discoverApp } from '../../../src/inventory/app_context.js'
import { collectDataStores } from '../../../src/inventory/sources/data_stores.js'
import { analyzeHandler } from '../../../src/inventory/graph/call_graph.js'
import { transformerResolver } from '../../../src/inventory/resolvers/transformer.js'
import { fixturePath, loadFixture, posix } from '../../helpers.js'

const analyseHandler = async () => {
  const root = fixturePath('patterns', 'transformer')
  const app = await discoverApp(root)
  const { stores } = await collectDataStores(app)

  return analyzeHandler(app, stores, {
    file: path.join(root, 'app/collect/controllers/expire_invite_controller.ts'),
    member: 'handle',
  })
}

/**
 * `transform()` and `paginate()` live in `@adonisjs/core`, so resolving the
 * symbol lands on the application file and finds no body. The naive reading is
 * that the tracer must step into node_modules; it does not — those methods call
 * BACK into `toObject()`, which the application writes.
 */
test.group('resolver: transformer', () => {
  test('follows the package API into the body the application wrote', async ({ assert }) => {
    const behavior = await analyseHandler()
    const step = behavior.trace.find((s) => s.by === 'transformer')

    assert.exists(step, 'the trace has to name the strategy, or the FTR is indefensible')
    assert.equal(step!.member, 'toObject')
  })

  /**
   * Without this the table written inside `toObject()` is reached by nobody and
   * drops out of the count entirely under AFP §6.5.4 — a whole data function,
   * not a rounding error.
   */
  test('a store written only inside the transformer is reached', async ({ assert }) => {
    const behavior = await analyseHandler()

    assert.include(behavior.touches, 'Audit')
    assert.isTrue(behavior.writes)
  })

  test('and nothing is left unresolved', async ({ assert }) => {
    const behavior = await analyseHandler()
    assert.isEmpty(behavior.unresolved)
  })

  /**
   * The control. Claiming this would mean the resolver matched on the method
   * name — and `transform` is as plausible on an application helper as on a
   * framework base.
   */
  test('an application class that merely owns `transform` is not claimed', async ({ assert }) => {
    const fixture = await loadFixture('transformer')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const claimed = fixture
      .callsIn(controller, 'format')
      .flatMap((call) => transformerResolver.resolve(call, ctx))

    assert.isEmpty(claimed, 'it extends nothing from a package, so it is not a transformer')
  })

  test('while the real one in the same file is claimed', async ({ assert }) => {
    const fixture = await loadFixture('transformer')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const claimed = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => transformerResolver.resolve(call, ctx))

    assert.lengthOf(claimed, 1)
    assert.equal(claimed[0].member, 'toObject')
    assert.include(posix(claimed[0].file), 'transformers/invite_transformer.ts')
  })
})
