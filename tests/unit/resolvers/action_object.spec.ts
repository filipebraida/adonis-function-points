import { test } from '@japa/runner'

import { actionObjectResolver } from '../../../src/inventory/resolvers/action_object.js'
import { loadFixture } from '../../helpers.js'

test.group('resolver: action object', () => {
  test('segue `new Action().handle()` instanciado inline', async ({ assert }) => {
    const fixture = await loadFixture('action_object')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => actionObjectResolver.resolve(call, ctx))

    assert.lengthOf(refs, 1)
    assert.include(refs[0].file, 'actions/expire_invite.ts')
    assert.equal(refs[0].member, 'handle')
  })

  test('segue a action guardada numa variável local', async ({ assert }) => {
    const fixture = await loadFixture('action_variable')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => actionObjectResolver.resolve(call, ctx))

    assert.lengthOf(refs, 1)
    assert.include(refs[0].file, 'actions/expire_invite.ts')
    assert.equal(refs[0].member, 'handle')
  })

  test('não reclama de padrões que não são dele', async ({ assert }) => {
    for (const pattern of ['fat_controller', 'module_function']) {
      const fixture = await loadFixture(pattern)
      const controller = fixture.controller()
      const ctx = fixture.contextFor(controller)

      const refs = fixture
        .callsIn(controller, 'handle')
        .flatMap((call) => actionObjectResolver.resolve(call, ctx))

      assert.lengthOf(refs, 0, `${pattern} não deveria casar com action-object`)
    }
  })
})
