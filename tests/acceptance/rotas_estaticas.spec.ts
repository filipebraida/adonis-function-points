import { test } from '@japa/runner'

import { runInventory } from '../../src/cli/runners.js'
import { analyze } from '../../src/pipeline.js'
import { appFixturePath } from '../helpers.js'

/**
 * THE WHOLE LIST OF ROUTES NOT COUNTED — plan 0.14 §A
 *
 * The warning shows 25 and says where the rest is. Under 0.13 it said "fp:inventory lists
 * every entry point" and fp:inventory listed none: a reviewing team rebuilt the list from
 * the application's route registry to find two functions the count had lost.
 */
const root = appFixturePath('rotas_estaticas')

test.group('not counted: the whole list', () => {
  test('the count is the one route that reads a store', async ({ assert }) => {
    const { count } = await analyze(root)
    assert.equal(count.totals.unadjusted, 9)
  })

  test('the warning shows 25 and points at a list that exists', async ({ assert }) => {
    const { count } = await analyze(root)
    const lines = count.confidence.warnings
    assert.include(lines, '  … and 2 more — fp:inventory lists every one under "not counted"')
    assert.lengthOf(
      lines.filter((l) => /^ {2}GET \/paginas\//.test(l)),
      25
    )
  })

  test('the count and the inventory carry every route, structured', async ({ assert }) => {
    const { count, inventory } = await analyze(root)
    for (const list of [count.confidence.notCounted, inventory.notCounted]) {
      assert.lengthOf(list!, 27)
      assert.deepEqual(list![0], { entryPoint: 'GET /paginas/01', reason: 'reaches no data store' })
    }
  })

  test('fp:inventory prints them all', async ({ assert }) => {
    const { output } = await runInventory({ root })
    assert.include(output, 'not counted (27):')
    for (let i = 1; i <= 27; i++)
      assert.include(output, `  GET /paginas/${String(i).padStart(2, '0')} — reaches no data store`)
  })
})
