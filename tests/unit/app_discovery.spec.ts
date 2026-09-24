import { test } from '@japa/runner'
import path from 'node:path'

import { discoverApp } from '../../src/inventory/app_context.js'
import { appFixturePath } from '../helpers.js'

const rel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/')

test.group('AppContext: route files', () => {
  /**
   * The adonisrc `preloads` list is the authoritative source — not a path
   * convention. Real applications use several topologies; these fixtures cover
   * the common ones.
   */
  test('topology: a single file in start/', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.deepEqual(
      app.routeFiles.map((f) => rel(app.root, f)),
      ['start/routes.ts']
    )
  })

  test('topology: one file per module', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_modular'))
    assert.deepEqual(
      app.routeFiles.map((f) => rel(app.root, f)),
      ['app/catalog/routes.ts']
    )
  })

  /**
   * The hardest topology: the preload points at a hub that declares no route at
   * all, it only re-exports. Stopping at the preload would return an empty list.
   *
   * The hub is a TRAVERSAL step, not a route file — there is no `router.` call
   * in it to parse. The distinction matters: `routeFiles` is what the parser
   * will open, and opening the hub would be work with no result.
   */
  test('topology: a hub that only imports other files', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))
    const files = app.routeFiles.map((f) => rel(app.root, f))

    assert.deepEqual(files, ['start/routes/web.ts'])
  })

  test('does not mistake a non-route preload for one', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.notInclude(app.routeFiles.join(' '), 'kernel')
  })
})

test.group('AppContext: scan roots', () => {
  /**
   * An application can keep all of its writes outside `app/` — under `src/`,
   * for instance. Scanning only `app/` would miss the whole application.
   */
  test('includes a directory outside app/ when an alias points there', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))
    const roots = app.scanRoots.map((r) => rel(app.root, r)).sort()

    assert.include(roots, 'src/catalog')
    assert.include(roots, 'app')
  })

  /**
   * `#admin/*` points at `app/admin`, already inside `app`. Keeping both would
   * scan every admin file twice — and, worse, change the computed module.
   */
  test('collapses a root nested inside another', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))
    const roots = app.scanRoots.map((r) => rel(app.root, r))

    assert.notInclude(roots, 'app/admin')
  })

  test('does not include a directory that does not exist', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    for (const root of app.scanRoots) {
      assert.isTrue(rel(app.root, root).length > 0)
    }
  })

  /**
   * Test factories write to the database too. Scanning them would count test
   * writes as application functions — and the number goes onto an invoice.
   *
   * `config/` and `database/migrations` likewise: they are not business code
   * reachable from an entry point.
   */
  test('excludes roots that are not application code', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    const roots = app.scanRoots.map((r) => rel(app.root, r))

    assert.notInclude(roots, 'tests')
    assert.notInclude(roots, 'config')
    assert.notInclude(roots, 'database')
  })
})

test.group('AppContext: module for grouping', () => {
  test('a flat layout has no module', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.equal(app.moduleOf(app.resolveSpecifier('#models/book')!), 'app')
  })

  test('a simple module', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_modular'))
    assert.equal(app.moduleOf(app.resolveSpecifier('#catalog/models/book')!), 'catalog')
  })

  /** Nested modules exist in the wild (`app/admin/taxonomies`). */
  test('a nested module keeps the whole path', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))
    assert.equal(app.moduleOf(app.resolveSpecifier('#admin/catalog/models/book')!), 'admin/catalog')
  })

  /** A file outside `app/` still belongs to a recognisable module. */
  test('a file in src/ takes the module of its own root', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))
    assert.equal(app.moduleOf(app.resolveSpecifier('#catalog/actions/create_book')!), 'catalog')
  })

  test('a file outside every root does not break', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.isString(app.moduleOf(path.join(app.root, 'start', 'routes.ts')))
  })
})

test.group('AppContext: framework', () => {
  test('reads the versions from package.json', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))

    assert.equal(app.framework.core, 7)
    assert.equal(app.framework.lucid, 22)
    assert.equal(app.framework.orm, 'lucid')
  })

  /**
   * Out of v1 scope is reported, never counted wrong. With no declared
   * dependencies there is nothing to assert.
   */
  test('an app with no declared dependencies stays unknown', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('no_generated'))

    assert.isUndefined(app.framework.core)
    assert.equal(app.framework.orm, 'unknown')
    assert.isFalse(app.framework.supported)
  })

  test('v7 + Lucid 22 is supported in v1', async ({ assert }) => {
    for (const name of ['minimal_flat', 'minimal_modular', 'minimal_nogen']) {
      const app = await discoverApp(appFixturePath(name))
      assert.isTrue(app.framework.supported, `${name} should be supported`)
    }
  })
})
