import { test } from '@japa/runner'

import { staticServiceResolver } from '../../../src/inventory/resolvers/static_service.js'
import { loadFixture, posix } from '../../helpers.js'

test.group('resolver: static service', () => {
  test('follows `Service.method()`', async ({ assert }) => {
    const fixture = await loadFixture('static_service')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => staticServiceResolver.resolve(call, ctx))

    assert.lengthOf(refs, 1)
    assert.include(posix(refs[0].file), 'services/invite_service.ts')
    assert.equal(refs[0].member, 'expire')
  })

  test('ignores calls on a model, which belong to the persistence detector', async ({ assert }) => {
    const fixture = await loadFixture('fat_controller')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => staticServiceResolver.resolve(call, ctx))

    // `Invite.findByOrFail` is not a service; the model is not among the
    // service imports, so nothing should be followed as a body to analyse.
    const models = refs.filter((r) => posix(r.file).includes('/models/'))
    assert.lengthOf(models, 0)
  })
})
