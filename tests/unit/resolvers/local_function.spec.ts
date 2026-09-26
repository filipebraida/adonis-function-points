import { test } from '@japa/runner'

import { localFunctionResolver } from '../../../src/inventory/resolvers/local_function.js'
import { moduleFunctionResolver } from '../../../src/inventory/resolvers/module_function.js'
import { loadFixture, posix } from '../../helpers.js'

/**
 * A query object that keeps its helpers beside it is common, and before this
 * every such call was unresolved: the store a helper read was reached by nobody
 * from that route, and a value built by it left as a whole table handed in.
 */
test.group('resolver: local function', () => {
  test('follows a function declaration and a module-level arrow of the same file', async ({
    assert,
  }) => {
    const fixture = await loadFixture('local_function')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => localFunctionResolver.resolve(call, ctx))

    const members = refs.map((ref) => ref.member).sort()
    assert.deepEqual(members, ['buscar', 'expirar', 'paraTela'])
    assert.isTrue(refs.every((ref) => posix(ref.file).endsWith('expire_invite_controller.ts')))
  })

  test('leaves a closure declared inside the body alone: it is walked with the body', async ({
    assert,
  }) => {
    const fixture = await loadFixture('local_function')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => localFunctionResolver.resolve(call, ctx))

    assert.notInclude(
      refs.map((ref) => ref.member),
      'pendente'
    )
  })

  test('`rows.map(fn)` names a function: local when declared here, imported when not', async ({
    assert,
  }) => {
    const fixture = await loadFixture('local_function')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)
    const calls = fixture.callsIn(controller, 'handle')

    const imported = calls.flatMap((call) => moduleFunctionResolver.resolve(call, ctx))
    assert.lengthOf(imported, 1)
    assert.equal(imported[0].member, 'rotuloDe')
    assert.include(posix(imported[0].file), 'services/rotulos.ts')

    // and the local resolver does not claim what is imported
    const local = calls.flatMap((call) => localFunctionResolver.resolve(call, ctx))
    assert.notInclude(
      local.map((ref) => ref.member),
      'rotuloDe'
    )
  })
})
