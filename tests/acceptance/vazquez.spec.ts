import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectDataStores } from '../../src/inventory/sources/data_stores.js'
import { collectEntryPoints } from '../../src/inventory/sources/routes_ast.js'
import { createAnalyzer } from '../../src/inventory/graph/call_graph.js'
import { count } from '../../src/albrecht/counter.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * EXTERNAL BENCHMARK — Vazquez, Simões and Albert (2011)
 *
 * The only reference in this project that we did not produce: a published
 * manual count, over a specification we did not write.
 *
 * The fixture and the reference (`fixtures/apps/vazquez/REFERENCE.md`) were
 * frozen in their own commit BEFORE the counter was ever run against them, and
 * the transcription choices are documented there. Without that the independence
 * would be illusory: nothing would stop us adjusting the fixture until the
 * number matched.
 *
 * References: reference count 46 FP · Ligeiro automatic 52 (+13%) · manual
 * under Ligeiro's rules 43 (−6.5%).
 */

/** the reference, function by function — Table 6.7, VAZQUEZ et al. (2011) column */
const REFERENCE = {
  total: 46,
  data: {
    Pessoa: { type: 'EIF', det: 4, refs: 1, fp: 5 },
    Justificativa: { type: 'ILF', det: 3, refs: 1, fp: 7 },
    Apontamento: { type: 'ILF', det: 4, refs: 1, fp: 7 },
  },
  transactions: {
    'GET /apontamentos': { label: 'Consulta Apontamento Diário', fp: 3 },
    'POST /apontamentos': { label: 'Registro de Ponto', fp: 3 },
    'PUT /apontamentos/:param': { label: 'Alteração de Apontamento', fp: 4 },
    'DELETE /apontamentos/:param': { label: 'Exclusão de Apontamento', fp: 3 },
    'POST /apontamentos/justificar': { label: 'Apontamento c/ Justificativa', fp: 4 },
    'GET /presenca': { label: 'Acompanhar Presença', fp: 5 },
    'GET /presenca/relatorio': { label: 'Emitir Relatório de Presença', fp: 5 },
  },
} as const

async function countFixture(): Promise<CountResult> {
  const app = await discoverApp(appFixturePath('vazquez'))
  const { stores } = await collectDataStores(app)
  const { entryPoints } = await collectEntryPoints(app)
  const analyzer = createAnalyzer(app, stores)

  const behaviors = new Map(
    entryPoints
      .filter((entry) => entry.handler)
      .map((entry) => [entry.id, analyzer.analyze(entry.handler!)])
  )

  // `Pessoa` belongs to access control, outside the boundary — see REFERENCE.md
  return count(
    { app, stores, entryPoints, behaviors },
    { boundary: { externallyMaintained: ['Pessoa'] } }
  )
}

const fn = (result: CountResult, name: string) => result.functions.find((f) => f.name === name)

test.group('Vazquez benchmark: data functions', () => {
  /**
   * The data functions are the predictable half of the count: they come from
   * the columns, with almost no heuristic. Exactness here is the minimum bar.
   */
  test('the three data functions match the reference exactly', async ({ assert }) => {
    const result = await countFixture()

    for (const [name, expected] of Object.entries(REFERENCE.data)) {
      const counted = fn(result, name)
      assert.exists(counted, `${name} was not counted`)
      assert.equal(counted!.type, expected.type, `${name}: type`)
      assert.equal(counted!.det, expected.det, `${name}: DET`)
      assert.equal(counted!.refs, expected.refs, `${name}: RET`)
      assert.equal(counted!.points, expected.fp, `${name}: FP`)
    }
  })
})

test.group('Vazquez benchmark: transactional functions', () => {
  test('the seven transactions of the case study are identified', async ({ assert }) => {
    const result = await countFixture()

    for (const [identity, expected] of Object.entries(REFERENCE.transactions)) {
      assert.exists(fn(result, identity), `${expected.label} (${identity}) was not counted`)
    }
  })

  /**
   * The two divergences were PREDICTED in REFERENCE.md before the run, and
   * come from the standard, not from defects:
   *
   *   +1  `Consulta Apontamento Diário` is an EQ in the reference. AFP §6.5.3
   *       requires collapsing EQ into EO, because primary intent is not
   *       detectable — and an EO weighs more than an EQ in the same band.
   *   −1  `Apontamento c/ Justificativa`: the IFPUG manual counts 1 DET for the
   *       user message, AFP does not. This is the systematic divergence Ligeiro
   *       measured as well.
   */
  test('the divergences are exactly the two predicted', async ({ assert }) => {
    const result = await countFixture()

    const divergent = Object.entries(REFERENCE.transactions)
      .map(([identity, expected]) => ({
        identity,
        expected: expected.fp,
        obtained: fn(result, identity)?.points ?? 0,
      }))
      .filter((item) => item.obtained !== item.expected)

    assert.deepEqual(
      divergent.map((d) => `${d.identity} ${d.expected}->${d.obtained}`).sort(),
      ['GET /apontamentos 3->4', 'POST /apontamentos/justificar 4->3'],
      'an unpredicted divergence appeared, or a predicted one disappeared'
    )
  })

  test('five of the seven transactions match exactly', async ({ assert }) => {
    const result = await countFixture()

    const exact = Object.entries(REFERENCE.transactions).filter(
      ([identity, expected]) => fn(result, identity)?.points === expected.fp
    )

    assert.lengthOf(exact, 5)
  })
})

test.group('Vazquez benchmark: total', () => {
  /**
   * The total matches exactly — but partly by CANCELLATION: the two predicted
   * divergences are +1 and −1.
   *
   * Recording that matters. The total is more stable than the individual
   * classification, and here is the confirmation against an external reference:
   * 8 of 10 functions exact, and the two that miss cancel out. Anyone defending
   * the count function by function needs to know this.
   */
  test('the total matches the reference, with the divergences cancelling', async ({ assert }) => {
    const result = await countFixture()

    assert.equal(result.totals.unadjusted, REFERENCE.total)

    const exact = result.functions.filter((f) => {
      const data = REFERENCE.data[f.name as keyof typeof REFERENCE.data]
      const tx = REFERENCE.transactions[f.name as keyof typeof REFERENCE.transactions]
      return data ? f.points === data.fp : tx ? f.points === tx.fp : false
    })

    assert.lengthOf(exact, 8, '8 of the 10 functions match exactly')
  })

  /** Declared tolerance: Ligeiro landed at +13%; we require far less. */
  test('the deviation stays within the declared 5% tolerance', async ({ assert }) => {
    const result = await countFixture()
    const deviation = Math.abs(result.totals.unadjusted - REFERENCE.total) / REFERENCE.total

    assert.isBelow(deviation, 0.05)
  })

  /** A good total with bad tracing would be worth nothing. */
  test('the count depends on no unresolved call nor handler-less route', async ({ assert }) => {
    const result = await countFixture()

    assert.equal(result.confidence.unresolvedCalls, 0)
    assert.equal(result.confidence.entryPointsWithoutHandler, 0)
  })
})
