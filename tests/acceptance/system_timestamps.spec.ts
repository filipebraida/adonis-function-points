import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * SYSTEM TIMESTAMPS — counting-decisions §6
 *
 * `autoCreate` / `autoUpdate` say the framework stamps the column. The user
 * neither supplies nor recognises it, which is the ground `isPrimary` was
 * already excluded on. The reference (`fixtures/apps/system_timestamps/REFERENCE.md`)
 * was committed before this rule existed.
 *
 * The fixture is too small for the points to move — the reference asserts DETs,
 * because DETs are what the rule changes and what crosses a band on a real
 * application.
 */
const REFERENCE = {
  total: 18,
  functions: {
    'Tarefa': { type: 'ILF', det: 3, fp: 7 },
    'GET /tarefas': { type: 'EO', det: 3, fp: 4 },
    'GET /tarefas/recentes': { type: 'EO', det: 1, fp: 4 },
    'POST /tarefas': { type: 'EI', det: 1, fp: 3 },
  },
} as const

let cached: CountResult | undefined
const countFixture = async (): Promise<CountResult> => {
  if (!cached) {
    const analysis = await analyze(appFixturePath('system_timestamps'))
    cached = analysis.count
  }
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('system timestamps are not DETs', () => {
  test('every function matches the reference', async ({ assert }) => {
    const result = await countFixture()

    for (const [name, expected] of Object.entries(REFERENCE.functions)) {
      const counted = fn(result, name)
      assert.equal(counted.type, expected.type, `${name}: type`)
      assert.equal(counted.det, expected.det, `${name}: DET`)
      assert.equal(counted.points, expected.fp, `${name}: FP`)
    }

    assert.equal(result.totals.unadjusted, REFERENCE.total)
    assert.equal(result.confidence.unresolvedCalls, 0)
  })

  /** The control: a `dateTime` the USER sets counts. The rule is about who maintains the column. */
  test('on the data function: the key and the stamps leave, the user-set date stays', async ({
    assert,
  }) => {
    const tarefa = fn(await countFixture(), 'Tarefa')

    assert.deepEqual(tarefa.rationale.detSources.sort(), [
      'ast:tarefas.concluida',
      'ast:tarefas.concluidaEm',
      'ast:tarefas.titulo',
    ])
  })

  test('on an output read whole: the same three', async ({ assert }) => {
    const index = fn(await countFixture(), 'GET /tarefas')

    assert.deepEqual(index.rationale.detSources.sort(), [
      'output:Tarefa.concluida',
      'output:Tarefa.concluidaEm',
      'output:Tarefa.titulo',
    ])
  })

  /** A transformer that re-emits `createdAt` does not make it user-recognisable. */
  test('on an output through a transformer: the stamp it emits is still not a DET', async ({
    assert,
  }) => {
    const recentes = fn(await countFixture(), 'GET /tarefas/recentes')

    assert.deepEqual(recentes.rationale.detSources, ['transformer:TarefaTransformer.titulo'])
  })

  /** The fact is recorded on the inventory, so a reader can see WHICH columns were excluded and why. */
  test('the inventory marks the stamped columns as system-maintained', async ({ assert }) => {
    const { inventory } = await analyze(appFixturePath('system_timestamps'))
    const tarefa = inventory.dataStores.find((store) => store.name === 'Tarefa')!

    const system = tarefa.attributes.filter((a) => a.system).map((a) => a.name)
    assert.deepEqual(system.sort(), ['createdAt', 'updatedAt'])
    assert.isUndefined(tarefa.attributes.find((a) => a.name === 'concluidaEm')!.system)
  })
})
