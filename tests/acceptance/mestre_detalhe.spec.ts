import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * MASTER-DETAIL — counting-decisions §10
 *
 * A detail the user only ever sees inside its master is a RET of the master's
 * ILF, not an ILF of its own. The signal is usage: no application code
 * addresses the child directly. The reference
 * (`fixtures/apps/mestre_detalhe/REFERENCE.md`) was committed before the rule
 * existed, with the previous rule set's 51 predicted beside its 41.
 *
 * Two controls live in the fixture: `Comentario` is a `hasMany` child WITH its
 * own route and stays its own file; `Etiqueta` hangs off two parents and stays
 * apart, reported.
 */
const REFERENCE = {
  total: 41,
  functions: {
    'Pedido': { type: 'ILF', det: 8, refs: 2, fp: 7 },
    'Comentario': { type: 'ILF', det: 3, refs: 1, fp: 7 },
    'Etiqueta': { type: 'EIF', det: 3, refs: 1, fp: 5 },
    'GET /pedidos': { type: 'EO', det: 8, refs: 1, fp: 4 },
    'GET /pedidos/:param': { type: 'EO', det: 15, refs: 3, fp: 5 },
    'POST /pedidos': { type: 'EI', det: 3, refs: 1, fp: 3 },
    'POST /pedidos/:param/itens': { type: 'EI', det: 4, refs: 1, fp: 3 },
    'POST /pedidos/:param/comentarios': { type: 'EI', det: 3, refs: 2, fp: 3 },
    'GET /comentarios': { type: 'EO', det: 3, refs: 1, fp: 4 },
  },
} as const

let cached: CountResult | undefined
const countFixture = async (): Promise<CountResult> => {
  if (!cached) {
    const analysis = await analyze(appFixturePath('mestre_detalhe'))
    cached = analysis.count
  }
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('master-detail: the reference, function by function', () => {
  test('every function matches the reference, and the detail is not one of them', async ({
    assert,
  }) => {
    const result = await countFixture()

    for (const [name, expected] of Object.entries(REFERENCE.functions)) {
      const counted = fn(result, name)
      assert.equal(counted.type, expected.type, `${name}: type`)
      assert.equal(counted.det, expected.det, `${name}: DET`)
      assert.equal(counted.refs, expected.refs, `${name}: RET/FTR`)
      assert.equal(counted.points, expected.fp, `${name}: FP`)
    }

    assert.isUndefined(
      result.functions.find((f) => f.name === 'ItemPedido'),
      'the detail is a RET of Pedido, not a data function'
    )
    assert.equal(result.totals.unadjusted, REFERENCE.total)
    assert.equal(result.confidence.unresolvedCalls, 0)
  })
})

test.group('master-detail: the group', () => {
  /** `fp:explain Pedido` has to say which RET is which, and why the link is not a DET */
  test('the master lists the detail as a RET, with the reason', async ({ assert }) => {
    const pedido = fn(await countFixture(), 'Pedido')

    assert.lengthOf(pedido.rationale.refSources, 2)
    assert.include(pedido.rationale.refSources[0], 'main group: pedidos')
    assert.include(pedido.rationale.refSources[1], 'subgroup:ItemPedido')
    assert.include(pedido.rationale.refSources[1], 'no application code addresses')
    assert.include(pedido.rationale.refSources[1], 'pedidoId')
  })

  test("the group's DETs are both tables' columns minus the key, the stamp and the link", async ({
    assert,
  }) => {
    const pedido = fn(await countFixture(), 'Pedido')

    assert.deepEqual(pedido.rationale.detSources.sort(), [
      'ast:itens_pedido.preco',
      'ast:itens_pedido.produto',
      'ast:itens_pedido.quantidade',
      'ast:pedidos.cliente',
      'ast:pedidos.emitidoEm',
      'ast:pedidos.observacao',
      'ast:pedidos.status',
      'ast:pedidos.total',
    ])
  })

  /** a transaction reaching master and detail reaches ONE logical file */
  test('a transaction touching the detail through the master pays one FTR', async ({ assert }) => {
    const result = await countFixture()

    assert.deepEqual(fn(result, 'GET /pedidos').rationale.refSources, [
      'reaches:Pedido (via ItemPedido)',
    ])
    assert.deepEqual(fn(result, 'POST /pedidos/:param/itens').rationale.refSources, [
      'reaches:Pedido (via ItemPedido)',
    ])
  })

  /** and the detail's link to the master is not an output DET either */
  test("the detail's link column is not an output DET", async ({ assert }) => {
    const index = fn(await countFixture(), 'GET /pedidos')

    assert.notInclude(index.rationale.detSources, 'output:ItemPedido.pedidoId')
    assert.include(index.rationale.detSources, 'output:ItemPedido.produto')
  })

  test('a write to the detail maintains the group: an ILF', async ({ assert }) => {
    const pedido = fn(await countFixture(), 'Pedido')
    assert.equal(pedido.type, 'ILF')
  })

  test('the grouping is stated in the report', async ({ assert }) => {
    const result = await countFixture()
    const grouped = result.confidence.warnings.find((w) => w.startsWith('grouped: ItemPedido'))

    assert.exists(grouped)
    assert.include(grouped!, 'RET of Pedido')
  })
})

test.group('master-detail: the controls', () => {
  /**
   * Without this control the rule would be "every hasMany child is a RET" —
   * which would merge `Apontamento` into `Pessoa` in the Vazquez benchmark,
   * against the published count.
   */
  test('a composition child with its own route stays its own data function', async ({ assert }) => {
    const result = await countFixture()
    const comentario = fn(result, 'Comentario')

    assert.equal(comentario.type, 'ILF')
    assert.equal(comentario.refs, 1)
    // its foreign key to Pedido is a DET: a link to a DIFFERENT data function
    assert.include(comentario.rationale.detSources, 'ast:comentarios.pedidoId')
    assert.equal(fn(result, 'Pedido').refs, 2, 'Pedido folds ItemPedido only')
  })

  test('a child of two parents stays apart, and the count says why', async ({ assert }) => {
    const result = await countFixture()
    const etiqueta = fn(result, 'Etiqueta')

    assert.equal(etiqueta.type, 'EIF', 'never written: used but not maintained')
    assert.equal(etiqueta.refs, 1)

    const warning = result.confidence.warnings.find((w) => w.startsWith('not grouped: Etiqueta'))
    assert.exists(warning)
    assert.include(warning!, 'Comentario and Pedido')
    assert.include(warning!, 'not derivable')
  })

  /** `none` is the 1.4.0 behaviour, kept to compare against an old count */
  test("`grouping: 'none'` keeps every table its own data function", async ({ assert }) => {
    const { count } = await analyze(appFixturePath('mestre_detalhe'), {
      dataFunctions: { grouping: 'none' },
    })

    assert.exists(count.functions.find((f) => f.name === 'ItemPedido'))
    assert.equal(fn(count, 'Pedido').refs, 1)
    assert.equal(fn(count, 'GET /pedidos').refs, 2)
    assert.equal(count.totals.unadjusted, 51, 'the previous rule set, as predicted in REFERENCE.md')
  })

  /** a configuration the code does not honour is worse than none */
  test('the removed `retStrategy` key is reported, not ignored', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('mestre_detalhe'), { retStrategy: 'constant' })

    assert.exists(
      count.confidence.warnings.find((w) => w.includes('`retStrategy` is no longer read'))
    )
  })
})
