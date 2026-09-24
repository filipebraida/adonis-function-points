import { test } from '@japa/runner'

import { staticServiceResolver } from '../../../src/inventory/resolvers/static_service.js'
import { loadFixture } from '../../helpers.js'

test.group('resolver: service estático', () => {
  test('segue `Service.metodo()`', async ({ assert }) => {
    const fixture = await loadFixture('static_service')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => staticServiceResolver.resolve(call, ctx))

    assert.lengthOf(refs, 1)
    assert.include(refs[0].file, 'services/invite_service.ts')
    assert.equal(refs[0].member, 'expire')
  })

  test('ignora chamadas em model, que são do detector de persistência', async ({ assert }) => {
    const fixture = await loadFixture('fat_controller')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => staticServiceResolver.resolve(call, ctx))

    // `Invite.findByOrFail` não é um service; o model não está nos imports
    // de service, então nada deve ser seguido como corpo a analisar.
    const models = refs.filter((r) => r.file.includes('/models/'))
    assert.lengthOf(models, 0)
  })
})
