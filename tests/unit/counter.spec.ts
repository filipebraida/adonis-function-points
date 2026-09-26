import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectDataStores } from '../../src/inventory/sources/data_stores.js'
import { collectEntryPoints } from '../../src/inventory/sources/routes_ast.js'
import { createAnalyzer } from '../../src/inventory/graph/call_graph.js'
import { count } from '../../src/albrecht/counter.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

async function countApp(name: string): Promise<CountResult> {
  const app = await discoverApp(appFixturePath(name))
  const { stores } = await collectDataStores(app)
  const { entryPoints } = await collectEntryPoints(app)
  const analyzer = createAnalyzer(app, stores)

  const behaviors = new Map(
    entryPoints
      .filter((entry) => entry.handler)
      .map((entry) => [entry.id, analyzer.analyze(entry.handler!)])
  )

  return count({
    app,
    stores,
    entryPoints,
    behaviors,
    addressedAnywhere: analyzer.addressedAnywhere(),
  })
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found)
    throw new Error(
      `function "${name}" not counted; present: ${result.functions.map((f) => f.name).join(', ')}`
    )
  return found
}

/**
 * The fixture application is small enough for the count to be checked by hand,
 * which is the only way to know the engine is right:
 *
 *   Author  2 DET (name, country) · read through a relation, never written
 *   Book    4 DET (authorId, title, isbn, publishedYear) · written
 *
 * Both carry a `createdAt` the framework stamps (`autoCreate`), which is not a
 * DET any more than the key is — counting-decisions §6.
 *
 *   GET    /books      reads Book and Author       -> EO
 *   POST   /books      writes Book                 -> EI
 *   DELETE /books/:id  writes Book                 -> EI
 */
test.group('count: data functions', () => {
  /**
   * AFP §6.5.4: if any transaction of the application writes it, it is an ILF.
   * If it is only read, an EIF.
   */
  test('written by the application is an ILF; only read is an EIF', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(fn(result, 'Book').type, 'ILF')
    assert.equal(fn(result, 'Author').type, 'EIF')
  })

  /** and the system timestamps — `createdAt` is `autoCreate` on both models (§6) */
  test('DET excludes the technical identifier and the system timestamps', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(fn(result, 'Author').det, 2)
    assert.equal(fn(result, 'Book').det, 4)
  })

  /**
   * counting-decisions §5: identity is the physical table, never the class.
   * Keyed by the class, renaming a model billed as a deletion plus an addition
   * in `fp:diff` for zero functional change.
   */
  test('a data function is identified by its table, not by its class', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(fn(result, 'Book').id, 'data:books')
    assert.equal(fn(result, 'Author').id, 'data:authors')
  })

  /** `Author hasMany Book`, but `Book` has its own routes: nothing folds, RET stays 1 (§10) */
  test('RET is 1 when no composition child is folded in', async ({ assert }) => {
    const result = await countApp('minimal_flat')
    assert.equal(fn(result, 'Book').refs, 1)
    assert.equal(fn(result, 'Author').refs, 1)
  })

  test('a low-complexity ILF is worth 7; an EIF is worth 5', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(fn(result, 'Book').complexity, 'low')
    assert.equal(fn(result, 'Book').points, 7)
    assert.equal(fn(result, 'Author').points, 5)
  })
})

test.group('count: transactional functions', () => {
  /** AFP §6.5.3: a transaction that modifies data is an EI; the rest are EOs. */
  test('a writer is an EI, a reader is an EO', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(fn(result, 'POST /books').type, 'EI')
    assert.equal(fn(result, 'DELETE /books/:param').type, 'EI')
    assert.equal(fn(result, 'GET /books').type, 'EO')
  })

  /** AFP collapses EQ into EO: primary intent is not detectable. */
  test('no function is classified as an EQ', async ({ assert }) => {
    const result = await countApp('minimal_flat')
    assert.notInclude(
      result.functions.map((f) => f.type),
      'EQ'
    )
  })

  test('FTR counts the stores reached', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    // the listing reaches Book and, through the preload, Author
    assert.equal(fn(result, 'GET /books').refs, 2)
    assert.equal(fn(result, 'POST /books').refs, 1)
  })

  /** counting-decisions §1: with no data access, it is not a transaction. */
  test('a transaction that reaches no data is not counted', async ({ assert }) => {
    const result = await countApp('edges_boundary')

    assert.exists(result.functions.find((f) => f.name === 'GET /notes'))
    assert.notExists(
      result.functions.find((f) => f.name === 'GET /about'),
      'a route that reaches no data is not a transactional function'
    )
  })
})

/**
 * The edges decided in counting-decisions, each with a table in the fixture
 * that exercises it. Without them the counter's guards survive mutation: in
 * `minimal_flat` every table is reached and every route reaches data.
 */
test.group('count: edges', () => {
  /** AFP §6.5.4: a store no transaction reaches does not enter the count. */
  test('an orphan store is not counted', async ({ assert }) => {
    const result = await countApp('edges_boundary')

    assert.exists(result.functions.find((f) => f.name === 'Note'))
    assert.notExists(
      result.functions.find((f) => f.name === 'OrphanLog'),
      'a table nobody reaches is not a data function'
    )
  })

  /**
   * AFP §6.5.2.1.1: a technical table leaves the count — and the report has to
   * say WHY, not merely omit it.
   */
  test('a technical table leaves the count and appears in the report', async ({ assert }) => {
    const result = await countApp('edges_boundary')

    assert.notExists(
      result.functions.find((f) => f.name === 'UserSession'),
      'a session table is temporary data per the spec'
    )
    assert.isTrue(
      result.confidence.warnings.some((w) => w.includes('UserSession')),
      'the exclusion must appear in the report'
    )
  })

  /**
   * A transaction touching only a technical table loses its FTR and, by §1,
   * stops being a transactional function — the table's exclusion propagates.
   */
  test('a transaction touching only a technical table is not counted', async ({ assert }) => {
    const result = await countApp('edges_boundary')
    assert.notExists(result.functions.find((f) => f.name === 'POST /sessions/touch'))
  })
})

test.group('count: totals and provenance', () => {
  test('the total is the sum of the functions', async ({ assert }) => {
    const result = await countApp('minimal_flat')
    const sum = result.functions.reduce((total, f) => total + f.points, 0)

    assert.equal(result.totals.unadjusted, sum)
    assert.isAbove(result.totals.unadjusted, 0)
  })

  test('the per-type totals close with the overall total', async ({ assert }) => {
    const result = await countApp('minimal_flat')
    const byType = Object.values(result.totals.byType).reduce((t, v) => t + v.points, 0)

    assert.equal(byType, result.totals.unadjusted)
  })

  /**
   * Provenance is a requirement, not decoration: if function points get
   * invoiced, someone will dispute a number, and a number without an origin is
   * indefensible.
   */
  test('every counted function states the rule that classified it', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    for (const counted of result.functions) {
      assert.isNotEmpty(counted.rationale.rule, `${counted.name} has no rule`)
      assert.match(counted.rationale.rule, /afp:/, 'the rule must cite the standard')
    }
  })

  test('DET and FTR say where they came from', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.isNotEmpty(fn(result, 'Book').rationale.detSources)
    assert.isNotEmpty(fn(result, 'GET /books').rationale.refSources)
  })

  /** The versioned ruleset is what makes two counts comparable. */
  test('the result declares the ruleset and its version', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(result.ruleset, 'afp')
    assert.match(result.rulesetVersion, /^\d+\.\d+\.\d+$/)
  })

  test('confidence reports unresolved calls and handler-less routes', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.isNumber(result.confidence.unresolvedCalls)
    assert.isNumber(result.confidence.entryPointsWithoutHandler)
  })
})
