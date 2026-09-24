import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectDataStores } from '../../src/inventory/sources/data_stores.js'
import { collectEntryPoints } from '../../src/inventory/sources/routes_ast.js'
import { createAnalyzer } from '../../src/inventory/graph/call_graph.js'
import { count } from '../../src/albrecht/counter.js'
import { appFixturePath } from '../helpers.js'

/**
 * THE GOLDEN INVARIANT
 *
 * The same logical application, written in different ways, must produce an
 * identical count.
 *
 * Three fixtures with the same two entities, the same three transactions and
 * the same logic, differing in everything that should NOT matter:
 *
 *                   minimal_flat        minimal_modular      minimal_nogen
 *   layout          app/models/         app/catalog/…        app/admin/catalog/…
 *   aliases         #models/*           #catalog/*           #admin/* + #catalog/*
 *   columns         generated schema    generated schema     @column on the model
 *   routes          start/routes.ts     app/catalog/routes   hub → start/routes/
 *   controller      generated map       generated map        lazy import
 *   write           app/actions/        app/catalog/actions  src/catalog/actions
 *   generated       yes                 yes                  NONE
 *
 * The first two were written by the same hand and share registry and schema
 * byte for byte: they are regression. The one that tests generalisation is the
 * third, which forces the AST path.
 *
 * If anything in the package starts depending on a folder convention, an alias
 * or a writing style, this test fails. It is the most important test in the
 * project, and that is why it was written before the first collector.
 *
 * The assertions were unlocked phase by phase — see
 * docs/design/implementation-plan.md.
 */
const APPS = ['minimal_flat', 'minimal_modular', 'minimal_nogen'] as const

test.group('golden invariant: shape does not change the count', () => {
  test('Phase 1 — the three apps are discovered equivalently', async ({ assert }) => {
    const apps = await Promise.all(APPS.map((name) => discoverApp(appFixturePath(name))))
    const [flat, modular, nogen] = apps

    for (const app of apps) {
      // each resolves its own aliases, which differ from one another
      assert.isTrue(app.subpathImports.size > 0)

      // all three are in v1 scope
      assert.isTrue(app.framework.supported)

      // all three expose routes, scan roots and the same reachable model
      assert.isNotEmpty(app.routeFiles, 'no route file')
      assert.isNotEmpty(app.scanRoots, 'no scan root')
    }

    // the equivalent model is reachable in all three, through distinct aliases
    assert.isNotNull(flat.resolveSpecifier('#models/book'))
    assert.isNotNull(modular.resolveSpecifier('#catalog/models/book'))
    assert.isNotNull(nogen.resolveSpecifier('#admin/catalog/models/book'))

    // the differences stay confined to layout and generated artefacts
    assert.equal(flat.layout, 'flat')
    assert.equal(modular.layout, 'module-per-domain')

    for (const app of [flat, modular]) {
      assert.isDefined(app.generated.dataSchema, 'data schema not found')
      assert.isDefined(app.generated.routeRegistry, 'registry not found')
    }

    // the third has no generated artefact at all — that is its point
    assert.isUndefined(nogen.generated.dataSchema)
    assert.isUndefined(nogen.generated.routeRegistry)
    assert.isUndefined(nogen.generated.controllersMap)
  })

  test('Phase 2 — the three apps produce the same data stores', async ({ assert }) => {
    const results = await Promise.all(
      APPS.map(async (name) => collectDataStores(await discoverApp(appFixturePath(name))))
    )

    /**
     * Comparable signature: name, table and columns. It deliberately does NOT
     * include `module` or `provenance` — those are exactly what changes between
     * layouts, and including them would make the test assert the opposite of
     * what it exists to assert.
     */
    const signature = (result: (typeof results)[number]) =>
      result.stores
        .map(
          (store) =>
            `${store.name}:${store.table}:${store.attributes
              .map((a) => a.name)
              .sort()
              .join(',')}`
        )
        .sort()
        .join(' | ')

    const [reference, ...others] = results.map(signature)

    for (const [index, other] of others.entries()) {
      assert.equal(other, reference, `${APPS[index + 1]} diverged from ${APPS[0]}`)
    }

    // and the signature describes the app all three implement
    assert.include(reference, 'Author:authors')
    assert.include(reference, 'Book:books')
    assert.include(reference, 'authorId,createdAt,id,isbn,publishedYear,title')
  })

  test('Phase 3 — the three apps produce the same entry points', async ({ assert }) => {
    const results = await Promise.all(
      APPS.map(async (name) => collectEntryPoints(await discoverApp(appFixturePath(name))))
    )

    /**
     * Compares by IDENTITY — verb plus normalised pattern. That is what
     * counting-decisions §5 defines as stable across versions, and exactly what
     * must not depend on how the route was written.
     */
    const signature = (result: (typeof results)[number]) =>
      result.entryPoints
        .map((entry) => entry.identity)
        .sort()
        .join(' | ')

    const [reference, ...others] = results.map(signature)

    for (const [index, other] of others.entries()) {
      assert.equal(other, reference, `${APPS[index + 1]} diverged from ${APPS[0]}`)
    }

    assert.equal(reference, 'DELETE /books/:param | GET /books | POST /books')

    // and all three resolve the handler of all three transactions
    for (const result of results) {
      assert.isEmpty(result.unresolved)
      for (const entry of result.entryPoints) assert.isNotNull(entry.handler)
    }
  })

  test('Phase 5 — the three apps produce an identical count', async ({ assert }) => {
    const results = await Promise.all(
      APPS.map(async (name) => {
        const app = await discoverApp(appFixturePath(name))
        const { stores } = await collectDataStores(app)
        const { entryPoints } = await collectEntryPoints(app)
        const analyzer = createAnalyzer(app, stores)

        const behaviors = new Map(
          entryPoints
            .filter((entry) => entry.handler)
            .map((entry) => [entry.id, analyzer.analyze(entry.handler!)])
        )

        return count({ app, stores, entryPoints, behaviors })
      })
    )

    /**
     * Count signature: type, DET, FTR and points per function.
     *
     * It deliberately does NOT include `module` or `rationale` — those are what
     * changes between layouts, and including them would make the test assert
     * the opposite of what it exists to assert.
     */
    const signature = (result: (typeof results)[number]) =>
      result.functions
        .map((fn) => `${fn.name}:${fn.type}:${fn.det}/${fn.refs}=${fn.points}`)
        .sort()
        .join(' | ')

    const [reference, ...others] = results.map(signature)

    for (const [index, other] of others.entries()) {
      assert.equal(other, reference, `${APPS[index + 1]} diverged from ${APPS[0]}`)
    }

    // and the total is the same in all three
    const totals = results.map((result) => result.totals.unadjusted)
    assert.deepEqual(totals, [totals[0], totals[0], totals[0]])
    assert.isAbove(totals[0], 0)
  })
})
