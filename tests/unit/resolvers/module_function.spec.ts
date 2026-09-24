import { test } from '@japa/runner'

import { moduleFunctionResolver } from '../../../src/inventory/resolvers/module_function.js'
import { loadFixture } from '../../helpers.js'

test.group('resolver: função de módulo', () => {
  test('segue `funcaoImportada()`', async ({ assert }) => {
    const fixture = await loadFixture('module_function')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => moduleFunctionResolver.resolve(call, ctx))

    assert.lengthOf(refs, 1)
    assert.include(refs[0].file, 'services/expire_invite.ts')
    assert.equal(refs[0].member, 'expireInvite')
  })
})
