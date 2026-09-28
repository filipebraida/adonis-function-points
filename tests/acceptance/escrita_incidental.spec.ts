import { test } from '@japa/runner'

import { incidentalWrites } from '../../src/inventory/resolvers/index.js'
import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * PRIMARY INTENT, DECLARED ABOUT THE CALL — plan 0.14 §C
 *
 * Measured on the three validated applications: 17 GET routes counted as EI, 3 of them
 * rightly (an account linked on a callback), 13 because a page counted its visit or created
 * a default on first read. The shapes are the same in the code; the library asks, the team
 * answers. Reference: `fixtures/apps/escrita_incidental/REFERENCE.md`, written first.
 */
const root = appFixturePath('escrita_incidental')
const declared = () =>
  analyze(root, {
    resolvers: {
      call: [
        incidentalWrites({
          name: 'visits and defaults',
          methods: ['registrarVisita', 'garantirCatalogo'],
        }),
      ],
    },
  })

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('incidental writes: without a declaration', () => {
  test('no point moves: three GET routes are EIs, 33 FP', async ({ assert }) => {
    const { count } = await analyze(root)
    assert.equal(count.totals.unadjusted, 33)
    for (const name of ['GET /pedidos/:param', 'GET /catalogo', 'GET /conta/callback'])
      assert.equal(fn(count, name).type, 'EI', name)
  })

  test('the GET routes counted as EI are listed, with what writes and where', async ({
    assert,
  }) => {
    const { count } = await analyze(root)
    const warnings = count.confidence.warnings
    const header = warnings.findIndex((w) =>
      w.startsWith(
        '3 GET route(s) counted as EI because they write — the CPM classifies by primary intent'
      )
    )
    assert.isAbove(header, -1, warnings.join('\n'))
    assert.deepEqual(warnings.slice(header + 1, header + 4), [
      '  GET /catalogo — writes Categoria (app/actions/garantir_catalogo.ts#garantirCatalogo)',
      '  GET /conta/callback — writes Conta (app/controllers/pedidos_controller.ts#callback)',
      '  GET /pedidos/:param — writes Pedido (app/actions/registrar_visita.ts#registrarVisita)',
    ])
  })
})

test.group('incidental writes: declared', () => {
  test('the two pages are EOs by what they show; the callback stays an EI; 35 FP', async ({
    assert,
  }) => {
    const { count } = await declared()
    const pedido = fn(count, 'GET /pedidos/:param')
    assert.equal(pedido.type, 'EO')
    assert.equal(pedido.det, 3)
    assert.equal(pedido.points, 4)
    assert.equal(fn(count, 'GET /catalogo').type, 'EO')
    assert.equal(fn(count, 'GET /catalogo').points, 4)
    assert.equal(fn(count, 'GET /conta/callback').type, 'EI')
    assert.equal(count.totals.unadjusted, 35)
  })

  test('the stores are still maintained: ILFs, and still FTRs', async ({ assert }) => {
    const { count } = await declared()
    assert.equal(fn(count, 'Pedido').type, 'ILF')
    assert.equal(fn(count, 'Categoria').type, 'ILF')
    assert.include(fn(count, 'GET /catalogo').rationale.refSources, 'reaches:Categoria')
  })

  test('the report says what the declaration did, and lists only the callback', async ({
    assert,
  }) => {
    const { count } = await declared()
    const warnings = count.confidence.warnings
    assert.include(
      warnings,
      '2 transaction(s) write only incidentally (declared) and are classified by what they show: GET /catalogo, GET /pedidos/:param'
    )
    const header = warnings.findIndex((w) => w.startsWith('1 GET route(s) counted as EI'))
    assert.isAbove(header, -1, warnings.join('\n'))
    assert.equal(
      warnings[header + 1],
      '  GET /conta/callback — writes Conta (app/controllers/pedidos_controller.ts#callback)'
    )
  })
})

test.group('incidental writes: a declaration that matches nothing', () => {
  test('is told it had no effect, and moves nothing', async ({ assert }) => {
    const { count } = await analyze(root, {
      resolvers: { call: [incidentalWrites({ name: 'typo', methods: ['registrarVisitas'] })] },
    })
    assert.include(
      count.confidence.warnings,
      'incidentalWrites("typo") matched no call: it had no effect'
    )
    assert.equal(count.totals.unadjusted, 33)
  })
})
