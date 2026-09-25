import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import { measureConformance, measureStructure } from '../../src/metrics/structure.js'
import { appFixturePath } from '../helpers.js'

const measure = async (name: string) => {
  const { inventory, count } = await analyze(appFixturePath(name))
  return {
    structure: measureStructure(inventory, count),
    conformance: measureConformance(inventory),
    inventory,
    count,
  }
}

/**
 * Why these metrics live beside function points: if function points pay, the
 * team optimises function points — more models, more endpoints, less reuse.
 * Density and coupling on the same dashboard are the counterweight. Without
 * them the measure becomes a target.
 *
 * And they come free: the graph already knows which transactions reach which
 * stores, so this is arithmetic over the inventory.
 */
test.group('metrics: coupling between modules', () => {
  /**
   * `coupled_modules`: the `faturamento` transaction writes `Nota` and READS
   * `Produto`, declared in `catalogo`. That is a usage dependency, not an
   * import one — a type-only import creates no functional coupling.
   */
  test('detects a usage dependency between modules', async ({ assert }) => {
    const { structure } = await measure('coupled_modules')

    const faturamento = structure.modules.find((m) => m.module === 'faturamento')!
    const catalogo = structure.modules.find((m) => m.module === 'catalogo')!

    assert.deepEqual(faturamento.dependsOn, ['catalogo'])
    assert.deepEqual(catalogo.dependedOnBy, ['faturamento'])
  })

  /** The dependency is directed: `catalogo` does not start depending on its users. */
  test('the dependency is not symmetric by accident', async ({ assert }) => {
    const { structure } = await measure('coupled_modules')
    const catalogo = structure.modules.find((m) => m.module === 'catalogo')!

    assert.isEmpty(catalogo.dependsOn)
    assert.isEmpty(structure.mutualDependencies)
  })

  /**
   * Martin's instability: `catalogo` is used and uses nobody, so it is stable
   * (0). `faturamento` only uses, so it is unstable (1).
   *
   * A stable module that changes often is where change hurts — that is what the
   * metric is for.
   */
  test('instability separates the used from the users', async ({ assert }) => {
    const { structure } = await measure('coupled_modules')

    assert.equal(structure.modules.find((m) => m.module === 'catalogo')!.instability, 0)
    assert.equal(structure.modules.find((m) => m.module === 'faturamento')!.instability, 1)
  })

  test('a module with no neighbour has zero instability', async ({ assert }) => {
    const { structure } = await measure('minimal_flat')

    // flat layout: a single module, nothing to depend on
    assert.lengthOf(structure.modules, 1)
    assert.equal(structure.modules[0].instability, 0)
  })

  test('instability stays between 0 and 1', async ({ assert }) => {
    for (const app of ['minimal_flat', 'minimal_modular', 'minimal_nogen', 'vazquez']) {
      const { structure } = await measure(app)
      for (const module of structure.modules) {
        assert.isAtLeast(module.instability, 0, `${app}/${module.module}`)
        assert.isAtMost(module.instability, 1, `${app}/${module.module}`)
      }
    }
  })

  test('invents no dependency from a module to itself', async ({ assert }) => {
    const { structure } = await measure('minimal_modular')

    for (const module of structure.modules) {
      assert.notInclude(module.dependsOn, module.module)
    }
  })

  test('a mutual dependency pair comes ordered, to avoid duplicates', async ({ assert }) => {
    for (const app of ['minimal_nogen', 'coupled_modules', 'vazquez']) {
      const { structure } = await measure(app)
      for (const [a, b] of structure.mutualDependencies) {
        assert.isTrue(a < b, `${app}: pair (${a}, ${b}) out of order`)
      }
    }
  })
})

test.group('metrics: density', () => {
  test('function points per data store', async ({ assert }) => {
    const { structure, count, inventory } = await measure('vazquez')

    assert.equal(
      structure.pointsPerDataStore,
      Math.round((count.totals.unadjusted / inventory.dataStores.length) * 1000) / 1000
    )
  })

  test('function points per module close with the overall total', async ({ assert }) => {
    const { structure, count } = await measure('vazquez')
    const sum = structure.modules.reduce((total, m) => total + m.functionPoints, 0)

    assert.equal(sum, count.totals.unadjusted)
  })

  test('does not divide by zero in an app with no store', async ({ assert }) => {
    const { structure } = await measure('minimal_flat')
    assert.isFinite(structure.pointsPerDataStore)
    assert.isFinite(structure.transactionsPerDataStore)
  })
})

test.group("metrics: conformance to the application's own conventions", () => {
  /**
   * Measures neither size nor quality: it measures whether the team follows
   * what it agreed on. In a software factory this is what becomes a standards
   * audit.
   */
  /**
   * The denominator is the transactions that take input, NOT every write.
   *
   * Measured over every write it read 39% on a healthy application, which invited
   * the conclusion that 61% of its writes were unvalidated. They were not: most
   * were workflow triggers that carry nothing beyond the route parameter, exactly
   * as counting-decisions §7 describes. It made its own author draw that
   * conclusion and build a warning on it, so the trap is load-bearing here.
   */
  test('transactions that take input declare it with a validator', async ({ assert }) => {
    const { conformance } = await measure('vazquez')

    /**
     * Five, not the four EIs the old denominator used: the two reads validate
     * their query too, and a field arriving on a GET is a DET like any other.
     */
    assert.equal(conformance.inputsWithValidator.total, 5)
    assert.equal(conformance.inputsWithValidator.ok, 5)
    assert.equal(conformance.inputsWithValidator.ratio, 1)
  })

  test('a delete carrying only a route parameter is not a conformance gap', async ({ assert }) => {
    const { conformance, inventory } = await measure('minimal_flat')

    const destroy = inventory.entryPoints.find((entry) => entry.signature.includes('/books/:'))!
    const behavior = inventory.behaviors.find((b) => b.entryPointId === destroy.id)!

    assert.isEmpty(behavior.inputFields)
    assert.isEmpty(
      behavior.requestFields,
      'it never reads the request: there is nothing to declare'
    )
    assert.equal(conformance.inputsWithValidator.ratio, 1, 'so it is outside the denominator')
  })

  test('an entry point with no handler shows in conformance', async ({ assert }) => {
    const { conformance } = await measure('edges_boundary')
    assert.equal(conformance.entryPointsWithHandler.ratio, 1, 'every route here has a handler')
  })

  /**
   * A store no transaction reaches may be a dead table or a gap in the tracer.
   * The reason stays visible instead of hidden inside the count.
   */
  test('an unreached store lowers conformance', async ({ assert }) => {
    const { conformance } = await measure('edges_boundary')

    // `OrphanLog` is reached by no transaction at all
    assert.isBelow(conformance.dataStoresReached.ratio, 1)
    assert.isAbove(conformance.dataStoresReached.ratio, 0)
  })

  test('the ratios stay between 0 and 1', async ({ assert }) => {
    for (const app of ['minimal_flat', 'vazquez', 'edges_boundary']) {
      const { conformance } = await measure(app)
      for (const [name, value] of Object.entries(conformance)) {
        assert.isAtLeast(value.ratio, 0, `${app}/${name}`)
        assert.isAtMost(value.ratio, 1, `${app}/${name}`)
      }
    }
  })
})
