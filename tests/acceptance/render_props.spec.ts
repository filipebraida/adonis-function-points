import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * THE DELIVERY IS THE BOUNDARY — plan 0.7 §A′, counting-decisions §6
 *
 * The DETs of an output are what the transaction hands to a renderer or a
 * response, not every column of every store it touched. The reference
 * (`fixtures/apps/render_props/REFERENCE.md`) was committed before the rule,
 * with the previous rule set's numbers predicted beside it: no function changes
 * points, every read changes what its DETs are made of — which is what the
 * measurement on three applications said too (−8, −2, +9 FP), and why the
 * fixture asserts DETs and their origin.
 */
const REFERENCE = {
  total: 52,
  functions: {
    'Produto': { type: 'ILF', det: 5, refs: 1, fp: 7 },
    'Fornecedor': { type: 'EIF', det: 2, refs: 1, fp: 5 },
    'Usuario': { type: 'EIF', det: 2, refs: 1, fp: 5 },
    'GET /produtos': { type: 'EO', det: 10, refs: 2, fp: 5 },
    'GET /produtos/:param': { type: 'EO', det: 7, refs: 2, fp: 5 },
    'GET /produtos/resumo': { type: 'EO', det: 2, refs: 1, fp: 4 },
    'GET /produtos/destaques': { type: 'EO', det: 8, refs: 2, fp: 5 },
    'GET /produtos/exportar': { type: 'EO', det: 5, refs: 1, fp: 4 },
    'GET /produtos/manifesto': { type: 'EO', det: 1, refs: 1, fp: 4 },
    'GET /produtos/:param/editar': { type: 'EO', det: 6, refs: 2, fp: 5 },
    'POST /produtos': { type: 'EI', det: 4, refs: 1, fp: 3 },
  },
} as const

let cached: CountResult | undefined
const countFixture = async (): Promise<CountResult> => {
  if (!cached) {
    const analysis = await analyze(appFixturePath('render_props'))
    cached = analysis.count
  }
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('delivery: the reference, function by function', () => {
  test('every function matches the reference in type, DET, FTR and points', async ({ assert }) => {
    const result = await countFixture()

    for (const [name, expected] of Object.entries(REFERENCE.functions)) {
      const counted = fn(result, name)
      assert.equal(counted.type, expected.type, `${name}: type`)
      assert.equal(counted.det, expected.det, `${name}: DET`)
      assert.equal(counted.refs, expected.refs, `${name}: FTR/RET`)
      assert.equal(counted.points, expected.fp, `${name}: FP`)
    }

    assert.equal(result.totals.unadjusted, REFERENCE.total)
    assert.equal(result.confidence.unresolvedCalls, 0)
  })
})

test.group('delivery: what each DET is', () => {
  /**
   * The collection came out of a query object: it delivers what that body reads,
   * Produto and the preloaded Fornecedor. `total` is derived. `busca` and `ativo`
   * entered as input and are echoed back: counted once, on entry (§7.3).
   */
  test('a query-object collection delivers what the body reads; a derived value is one DET; an echo is none', async ({
    assert,
  }) => {
    const index = fn(await countFixture(), 'GET /produtos')
    const sources = index.rationale.detSources

    assert.includeMembers(sources, ['request:busca', 'request:ativo', 'render:total'])
    assert.include(sources, 'output:Produto.nome')
    assert.include(sources, 'output:Fornecedor.nome')
    assert.notInclude(sources.join(' '), 'render:filtros', 'echoed input is not counted twice')
  })

  /** `Usuario` was read to authorise and delivered by nothing: an FTR, and not a DET */
  test('a store read but not delivered stays an FTR and contributes no output DET', async ({
    assert,
  }) => {
    const show = fn(await countFixture(), 'GET /produtos/:param')

    assert.equal(show.refs, 2, 'Usuario was read')
    assert.notInclude(show.rationale.detSources.join(' '), 'Usuario', 'and not shown')
    assert.includeMembers(show.rationale.detSources, [
      'param::id',
      'render:podeEditar',
      'output:Produto.nome',
    ])
  })

  /** props by identifier → a query object that returns a literal: its leaves, once, not the columns */
  test('a followed body that returns a literal delivers the leaves of that literal', async ({
    assert,
  }) => {
    const resumo = fn(await countFixture(), 'GET /produtos/resumo')

    assert.deepEqual(resumo.rationale.detSources.sort(), [
      'render:categorias.rotulo',
      'render:categorias.total',
    ])
  })

  /**
   * A document is made of what was handed into it: the CSV builder returns a
   * string and reads nothing, but it received the products. Found on a real
   * questionnaire report at 2 DET with 6 FTR.
   */
  test('a document built from rows delivers the rows: the stores flowing into the call leave', async ({
    assert,
  }) => {
    const exportar = fn(await countFixture(), 'GET /produtos/exportar')

    assert.lengthOf(exportar.rationale.detSources, 5)
    assert.isTrue(exportar.rationale.detSources.every((s) => s.startsWith('output:Produto.')))
  })

  /** with nothing readable flowing in, a document is one DET as a floor, and the report names it */
  test('a delivered value nobody can read is one DET, opaque, and reported', async ({ assert }) => {
    const result = await countFixture()
    const manifesto = fn(result, 'GET /produtos/manifesto')

    assert.deepEqual(manifesto.rationale.detSources, ['render:<gerarManifesto()> (opaque)'])
    assert.equal(manifesto.refs, 1, 'the count was read: an FTR, not delivered')
    const block = result.confidence.warnings.join('\n')
    assert.include(block, 'deliver a value the analysis cannot read')
    assert.include(block, 'GET /produtos/manifesto: <gerarManifesto()>')
    assert.notInclude(block, 'GET /produtos/exportar', 'the CSV over products is readable')
  })

  /** a home page assembling `[destaque, ...rows].slice(0, 4)` had fallen to 1 DET */
  test('an array assembled from a collection is still the collection', async ({ assert }) => {
    const destaques = fn(await countFixture(), 'GET /produtos/destaques')

    assert.include(destaques.rationale.detSources, 'render:total')
    assert.include(destaques.rationale.detSources, 'output:Produto.nome')
    assert.include(
      destaques.rationale.detSources,
      'output:Fornecedor.nome',
      'preloaded by the query object'
    )
    assert.notInclude(destaques.rationale.detSources.join(' '), '(opaque)')
  })

  /** `inertia.modal` is `render` by another name; a mapped literal contributes its leaves once */
  test('a mapped literal built in the controller contributes its leaves, once', async ({
    assert,
  }) => {
    const editar = fn(await countFixture(), 'GET /produtos/:param/editar')

    assert.includeMembers(editar.rationale.detSources, [
      'param::id',
      'transformer:ProdutoTransformer.nome',
      'render:fornecedores.id',
      'render:fornecedores.nome',
    ])
    assert.notInclude(editar.rationale.detSources.join(' '), 'output:Fornecedor', 'not the table')
  })
})

test.group('delivery: what the rule fixed on the way', () => {
  /** `select('categoria').count()` with a GROUP BY leaves the grouped column too — it was dropped */
  test('a select list survives an aggregate chain', async ({ assert }) => {
    const { inventory } = await analyze(appFixturePath('render_props'))
    const resumo = inventory.entryPoints.find((e) => e.name === 'produtos.resumo')!
    const behavior = inventory.behaviors.find((b) => b.entryPointId === resumo.id)!

    assert.deepEqual(behavior.outputReads.Produto.selected, ['categoria'])
    assert.isTrue(behavior.outputReads.Produto.aggregate)
  })
})
