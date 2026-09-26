import type { Node } from 'ts-morph'
import { test } from '@japa/runner'

import { membersOfType } from '../../src/inventory/graph/call_graph.js'
import { isNoise } from '../../src/inventory/graph/noise.js'
import { loadFixture } from '../helpers.js'

/**
 * `this.extras?.panel?.get(id)`: a `Map` handed in through the constructor, one level
 * down a named type. The noise filter knew `private names = new Map()`; it did not
 * know a lookup that arrives typed — two transformers on a validated application were
 * the only "unresolved calls" left in it (plan 0.11 §B).
 */
test.group('noise: native receivers through a named type', () => {
  test("a Map or Set member of a constructor parameter's type is noise", async ({ assert }) => {
    const fixture = await loadFixture('native_receivers')
    const controller = fixture.controller()
    const owner = controller.getClasses()[0]
    const membersOf = (typeNode: Node) => membersOfType(typeNode, controller, fixture.app)

    const calls = fixture.callsIn(controller, 'handle')
    const lookups = calls.filter((c) => /extras/.test(c.getExpression().getText()))
    assert.lengthOf(lookups, 2)
    for (const call of lookups) assert.isTrue(isNoise(call, owner, membersOf), call.getText())

    const store = calls.find((c) => c.getExpression().getText().includes('findByOrFail'))!
    assert.isFalse(isNoise(store, owner, membersOf), 'a store access is never noise')
  })
})
