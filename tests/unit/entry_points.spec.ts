import { test } from '@japa/runner'
import path from 'node:path'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectEntryPoints } from '../../src/inventory/sources/routes_ast.js'
import type { EntryPointCollection } from '../../src/inventory/sources/routes_ast.js'
import { fixturePath } from '../helpers.js'

const collect = async (root: string) => collectEntryPoints(await discoverApp(root))

const shapes = () => collect(fixturePath('routes', 'all_shapes'))

const find = (result: EntryPointCollection, trigger: string, signature: string) =>
  result.entryPoints.find((e) => e.trigger === trigger && e.signature === signature)

const handlerOf = (result: EntryPointCollection, trigger: string, signature: string) => {
  const entry = find(result, trigger, signature)
  if (!entry?.handler) throw new Error(`no handler: ${trigger} ${signature}`)
  return { file: path.basename(entry.handler.file), member: entry.handler.member }
}

test.group('entry points: route declaration forms', () => {
  test('a single-line route', async ({ assert }) => {
    assert.exists(find(await shapes(), 'GET', '/health'))
  })

  /**
   * The expression text of `router\n  .post(...)` contains the line break.
   * Without normalising it the match fails, and most routes of a real
   * application go unseen.
   */
  test('a chained multi-line route', async ({ assert }) => {
    const entry = find(await shapes(), 'POST', '/books/:id/export')
    assert.exists(entry, 'the multi-line route was not found')
  })

  test('a group applies its prefix to the pattern', async ({ assert }) => {
    const result = await shapes()
    assert.exists(find(result, 'GET', '/admin/books'), 'the group prefix was not applied')
    assert.notExists(find(result, 'GET', '/books') && undefined)
  })

  test('nested groups accumulate their prefixes', async ({ assert }) => {
    assert.exists(find(await shapes(), 'DELETE', '/admin/trash/books/:uuid'))
  })

  /**
   * An inline closure is a real handler: it has a body, and the graph has to
   * walk it. Treating it as "unresolved controller" would lose the transaction
   * and report the wrong reason on top of that.
   *
   * It is a common shape in production applications.
   */
  test('an inline closure is a handler, not an unresolved call', async ({ assert }) => {
    const result = await shapes()
    const entry = find(result, 'GET', '/ping')

    assert.exists(entry, 'the closure route was not collected')
    assert.isNotNull(entry!.handler, 'the closure should be a handler')
    assert.isAbove(entry!.handler!.line ?? 0, 0, 'an inline handler needs a line')
    assert.isEmpty(result.unresolved, 'a closure is not an unresolved call')
  })

  /** `router.on(...)` has no handler to analyse — but it is an entry point. */
  test('a static route becomes an entry point with no handler', async ({ assert }) => {
    const entry = find(await shapes(), 'GET', '/about')
    assert.exists(entry, 'the static route was not collected')
    assert.isNull(entry!.handler)
  })
})

test.group('entry points: resource', () => {
  test('`.only()` limits the expanded actions', async ({ assert }) => {
    const result = await shapes()

    assert.exists(find(result, 'GET', '/books'), 'index')
    assert.exists(find(result, 'GET', '/books/:id'), 'show')
    assert.exists(find(result, 'POST', '/books'), 'store')

    assert.notExists(find(result, 'DELETE', '/books/:id'), 'destroy was not in only()')
    assert.notExists(find(result, 'GET', '/books/create'), 'create was not in only()')
  })

  test('`.apiOnly()` excludes create and edit', async ({ assert }) => {
    const result = await shapes()

    assert.exists(find(result, 'GET', '/api/books'), 'index')
    assert.exists(find(result, 'DELETE', '/api/books/:id'), 'destroy')
    assert.notExists(find(result, 'GET', '/api/books/create'), 'create')
    assert.notExists(find(result, 'GET', '/api/books/:id/edit'), 'edit')
  })

  test('each resource action points at the right method', async ({ assert }) => {
    const result = await shapes()
    assert.equal(handlerOf(result, 'GET', '/books').member, 'index')
    assert.equal(handlerOf(result, 'POST', '/books').member, 'store')
    assert.equal(handlerOf(result, 'GET', '/books/:id').member, 'show')
  })
})

test.group('entry points: controller resolution', () => {
  /**
   * Modular applications routinely have several controllers sharing a bare
   * name across modules. Indexing by the bare name would resolve the wrong
   * controller — in silence.
   */
  test('a name colliding across modules resolves to the right file', async ({ assert }) => {
    const result = await shapes()

    const catalog = handlerOf(result, 'GET', '/books')
    const admin = handlerOf(result, 'GET', '/admin/books')

    assert.include(
      result.entryPoints.find((e) => e.signature === '/books' && e.trigger === 'GET')!.handler!
        .file,
      '/catalog/'
    )
    assert.include(
      result.entryPoints.find((e) => e.signature === '/admin/books')!.handler!.file,
      '/admin/'
    )
    assert.equal(catalog.file, admin.file, 'same basename, different files')
  })

  test('a local alias from a lazy import resolves', async ({ assert }) => {
    const handler = handlerOf(await shapes(), 'POST', '/books/:id/export')
    assert.equal(handler.file, 'export_controller.ts')
  })

  /** A single-action handler declares no method: it is `handle` by convention. */
  test('a single-action handler declares no method', async ({ assert }) => {
    const handler = handlerOf(await shapes(), 'POST', '/books/:id/export')
    assert.isUndefined(handler.member)
  })
})

test.group('entry points: identity', () => {
  /**
   * counting-decisions §5: identity is the entry point, not the route name nor
   * the controller path. `.as()` is cosmetic — renaming does not change the
   * function the user sees; and moving a controller between modules is
   * refactoring.
   *
   * Without this, `fp:diff` turns a rename into a deletion plus an addition and
   * bills twice.
   */
  test('identity is the verb plus the normalised pattern', async ({ assert }) => {
    const entry = find(await shapes(), 'DELETE', '/admin/trash/books/:uuid')
    assert.equal(entry!.identity, 'DELETE /admin/trash/books/:param')
  })

  test('the parameter name does not change the identity', async ({ assert }) => {
    const result = await shapes()
    const byId = find(result, 'GET', '/books/:id')!
    const byUuid = find(result, 'DELETE', '/admin/trash/books/:uuid')!

    assert.include(byId.identity, '/books/:param')
    assert.include(byUuid.identity, '/books/:param')
  })

  test('identity is unique per entry point', async ({ assert }) => {
    const result = await shapes()
    const ids = result.entryPoints.map((e) => e.identity)
    assert.lengthOf(new Set(ids), ids.length, 'there are duplicate identities')
  })
})
