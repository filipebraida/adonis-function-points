import { test } from '@japa/runner'

import { jobDispatchResolver } from '../../../src/inventory/resolvers/job_dispatch.js'
import { moduleFunctionResolver } from '../../../src/inventory/resolvers/module_function.js'
import { loadFixture, posix } from '../../helpers.js'

test.group('resolver: module function', () => {
  test('follows `importedFunction()`', async ({ assert }) => {
    const fixture = await loadFixture('module_function')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => moduleFunctionResolver.resolve(call, ctx))

    assert.lengthOf(refs, 2)
    assert.include(posix(refs[0].file), 'services/expire_invite.ts')
    assert.equal(refs[0].member, 'expireInvite')
  })

  test('follows the EXPORTED name through an alias', async ({ assert }) => {
    const fixture = await loadFixture('module_function')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => moduleFunctionResolver.resolve(call, ctx))

    const aliased = refs.find((ref) => posix(ref.file).includes('archive_invite.ts'))

    /**
     * `import { archiveInvite as archive }`: following the local name looks for
     * `archive` in a file that exports `archiveInvite`, finds no body, and
     * reports the call as unresolved for a reason that is not true.
     */
    assert.isDefined(aliased)
    assert.equal(aliased!.member, 'archiveInvite')
  })

  test('the alias still reaches the write', async ({ assert }) => {
    const fixture = await loadFixture('module_function')
    const body = fixture.sourceFile(posix(fixture.root) + '/app/collect/services/archive_invite.ts')

    assert.isNotNull(body)
  })
})

test.group('resolver: job dispatch', () => {
  test('follows `process` when the queue package names it that', async ({ assert }) => {
    const fixture = await loadFixture('job_dispatch')
    const controller = fixture.controller()
    const ctx = fixture.contextFor(controller)

    const refs = fixture
      .callsIn(controller, 'handle')
      .flatMap((call) => jobDispatchResolver.resolve(call, ctx))

    const archive = refs.find((ref) => posix(ref.file).includes('archive_invite_job.ts'))

    /**
     * `dispatch` belongs to the package's base class. Falling back to it means
     * resolving a file and then no body: the gap is reported and the write in
     * `process` never counted.
     */
    assert.isDefined(archive)
    assert.equal(archive!.member, 'process')
  })
})
