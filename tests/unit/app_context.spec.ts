import { test } from '@japa/runner'
import path from 'node:path'

import { discoverApp } from '../../src/inventory/app_context.js'
import { appFixturePath, posix } from '../helpers.js'

test.group('AppContext: subpath aliases', () => {
  /**
   * Two incompatible conventions are in use in the wild — by type (`#models/*`)
   * and by module (`#catalog/*`). Deducing from the shape works for one family
   * and fails for the other; the package.json has to be READ.
   */
  test('reads the map from package.json instead of deducing it', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    assert.isTrue(flat.subpathImports.has('#models/*'))
    assert.isFalse(flat.subpathImports.has('#catalog/*'))

    assert.isTrue(modular.subpathImports.has('#catalog/*'))
    assert.isFalse(modular.subpathImports.has('#models/*'))
  })

  test('resolves the same model through different aliases', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    assert.equal(
      path.basename(flat.resolveSpecifier('#models/book')!),
      path.basename(modular.resolveSpecifier('#catalog/models/book')!)
    )
  })

  test("translates the map's .js target to the .ts we analyse", async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.match(posix(app.resolveSpecifier('#models/book')!), /app\/models\/book\.ts$/)
  })

  /**
   * `#app/*` and `#app/legacy/*` both match `#app/legacy/importer`, and they
   * point at DIFFERENT places. The more specific one must win — that is what
   * Node's subpath imports spec requires — otherwise resolution silently lands
   * on the wrong file.
   *
   * The fixture exists because the rule is in the code, and unexercised code
   * rots.
   */
  test('the more specific alias beats the more generic one', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('overlapping_aliases'))
    const resolved = app.resolveSpecifier('#app/legacy/importer')!

    assert.match(posix(resolved), /vendor\/legacy\/importer\.ts$/)
    assert.notMatch(posix(resolved), /app\/legacy\/importer\.ts$/)
  })

  test('a non-overlapping alias resolves directly', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('overlapping_aliases'))
    assert.match(
      posix(app.resolveSpecifier('#core/database/schema')!),
      /app\/core\/database\/schema\.ts$/
    )
  })

  test('resolves an alias with no wildcard', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('overlapping_aliases'))
    assert.match(posix(app.resolveSpecifier('#exact')!), /billing\/models\/invoice\.ts$/)
  })

  test('returns null for a package specifier instead of guessing', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.isNull(app.resolveSpecifier('@adonisjs/core/http'))
    assert.isNull(app.resolveSpecifier('luxon'))
    assert.isNull(app.resolveSpecifier('#unknown/thing'))
  })
})

test.group('AppContext: generated artefacts', () => {
  test('finds the schema by what it is, not by where it is', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    assert.match(posix(flat.generated.dataSchema!), /(^|\/)database\/schema\.ts$/)
    assert.match(posix(modular.generated.dataSchema!), /app\/core\/database\/schema\.ts$/)
  })

  test('finds a generated schema in an unconventional path', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('overlapping_aliases'))
    assert.isDefined(app.generated.dataSchema)
  })

  /**
   * Absence is a reportable fact, not something to work around in silence:
   * without the registry the count falls back to the route parser, which is
   * less accurate. The report has to be able to say so — AFP requires that what
   * was missing appears.
   */
  test('reports absence instead of assuming', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('no_generated'))

    assert.isUndefined(app.generated.routeRegistry)
    assert.isUndefined(app.generated.controllersMap)
    assert.isUndefined(app.generated.dataSchema)
  })

  test('does not mistake a hand-written schema for a generated one', async ({ assert }) => {
    // no_generated has models with @column, but no generated file
    const app = await discoverApp(appFixturePath('no_generated'))
    assert.isUndefined(app.generated.dataSchema)
  })
})

test.group('AppContext: layout', () => {
  test('tells the two families apart', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    assert.equal(flat.layout, 'flat')
    assert.equal(modular.layout, 'module-per-domain')
  })

  test('groups by module when modular and without one when flat', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    assert.equal(modular.moduleOf(modular.resolveSpecifier('#catalog/models/book')!), 'catalog')
    assert.equal(flat.moduleOf(flat.resolveSpecifier('#models/book')!), 'app')
  })

  test('layout is the only field where the two apps differ', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    // the three generated artefacts are present on both sides
    const presence = (a: typeof flat) => Object.values(a.generated).filter(Boolean).length
    assert.equal(presence(flat), presence(modular))
    assert.notEqual(flat.layout, modular.layout)
  })
})
