import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * OUTPUT DETs — counting-decisions §6
 *
 * The reference (`fixtures/apps/transformed_output/REFERENCE.md`) was written
 * and committed before the code that narrows output DETs existed, with the
 * number the previous rule set produced predicted beside it (57 against 55).
 *
 * Eight transactions read the same tables in eight shapes. Only the shape
 * differs, and the shape is exactly what decides the DETs: a transformer's
 * keys for the store it is for, a `.select()` list, one scalar for a `.count()`,
 * or — when nothing is visible — every column.
 */
const REFERENCE = {
  total: 55,
  functions: {
    'Livro': { type: 'ILF', det: 9, refs: 1, fp: 7 },
    'Autor': { type: 'EIF', det: 2, refs: 1, fp: 5 },
    'Categoria': { type: 'EIF', det: 2, refs: 1, fp: 5 },
    'GET /livros/destaques': { type: 'EO', det: 6, refs: 3, fp: 5 },
    'GET /livros/painel': { type: 'EO', det: 3, refs: 2, fp: 4 },
    'GET /livros': { type: 'EO', det: 4, refs: 2, fp: 4 },
    'GET /livros/bruto': { type: 'EO', det: 11, refs: 2, fp: 5 },
    'GET /livros/resumo': { type: 'EO', det: 2, refs: 1, fp: 4 },
    'GET /livros/:param': { type: 'EO', det: 7, refs: 2, fp: 5 },
    'GET /livros/exportacao': { type: 'EO', det: 2, refs: 1, fp: 4 },
    'GET /autores': { type: 'EO', det: 1, refs: 1, fp: 4 },
    'POST /livros': { type: 'EI', det: 3, refs: 1, fp: 3 },
  },
} as const

let cached: CountResult | undefined
const countFixture = async (): Promise<CountResult> => {
  if (!cached) {
    const analysis = await analyze(appFixturePath('transformed_output'))
    cached = analysis.count
  }
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('output DETs: the reference, function by function', () => {
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
    assert.lengthOf(result.functions, Object.keys(REFERENCE.functions).length)
  })

  /** A good total with bad tracing would be worth nothing. */
  test('nothing is unresolved and every route has a handler', async ({ assert }) => {
    const result = await countFixture()

    assert.equal(result.confidence.unresolvedCalls, 0)
    assert.equal(result.confidence.entryPointsWithoutHandler, 0)
  })
})

test.group('output DETs: where each one came from', () => {
  /**
   * The transformer decides. Its keys replace the stores' columns rather than
   * adding to them — and the nested transformer's keys arrive through its own
   * body, so the `autor` key holding it is not a DET of its own.
   */
  test('a transformer on the path contributes its keys, and only its keys', async ({ assert }) => {
    const index = fn(await countFixture(), 'GET /livros')

    assert.deepEqual(index.rationale.detSources.sort(), [
      'transformer:AutorTransformer.nome',
      'transformer:AutorTransformer.totalLivros',
      'transformer:LivroTransformer.isbn',
      'transformer:LivroTransformer.titulo',
    ])
    assert.notInclude(index.rationale.detSources.join(' '), 'output:')
  })

  /** `id` is the identifier of `BaseTransformer<Livro>`'s resource: not a DET, as on the ILF. */
  test('the resource identifier re-emitted by the transformer is not a DET', async ({ assert }) => {
    const result = await countFixture()

    for (const name of ['GET /livros', 'GET /livros/:param']) {
      const sources = fn(result, name).rationale.detSources
      assert.notInclude(sources, 'transformer:LivroTransformer.id', name)
      assert.notInclude(sources, 'transformer:AutorTransformer.id', name)
    }
  })

  /** `forDetalhe()` spreads `toObject()`: the spread contributes nothing, the followed body does. */
  test('a method spreading `this.toObject()` adds its own keys to the followed ones', async ({
    assert,
  }) => {
    const show = fn(await countFixture(), 'GET /livros/:param')

    assert.includeMembers(show.rationale.detSources, [
      'param::id',
      'transformer:LivroTransformer.resumo',
      'transformer:LivroTransformer.paginas',
      'transformer:LivroTransformer.titulo',
      'transformer:AutorTransformer.nome',
    ])
    assert.notInclude(show.rationale.detSources.join(' '), '(opaque)')
  })

  test('`.select()` narrows the store to the columns named, in both spellings', async ({
    assert,
  }) => {
    const result = await countFixture()

    assert.deepEqual(fn(result, 'GET /livros/resumo').rationale.detSources.sort(), [
      'select:Livro.ano',
      'select:Livro.titulo',
    ])
    assert.deepEqual(fn(result, 'GET /autores').rationale.detSources, ['select:Autor.nome'])
  })

  /**
   * A transformer covers ITS resource, not the page. Recounting a real application
   * showed a questionnaire page at 4 DET with 5 FTR: the transformer of its header
   * had erased the questions rendered raw beside it.
   */
  test('a store passed raw beside a transformed one still contributes its columns', async ({
    assert,
  }) => {
    const destaques = fn(await countFixture(), 'GET /livros/destaques')

    assert.deepEqual(destaques.rationale.detSources.sort(), [
      'output:Categoria.descricao',
      'output:Categoria.nome',
      'transformer:AutorTransformer.nome',
      'transformer:AutorTransformer.totalLivros',
      'transformer:LivroTransformer.isbn',
      'transformer:LivroTransformer.titulo',
    ])
  })

  /** `.count()` leaves one derived scalar. A dashboard of counters is a handful of DETs, not a hundred. */
  test('an aggregate read is one DET for the store, not the table', async ({ assert }) => {
    const painel = fn(await countFixture(), 'GET /livros/painel')

    assert.deepEqual(painel.rationale.detSources.sort(), [
      'aggregate:Livro (a count or an existence check: one scalar)',
      'output:Autor.nome',
      'output:Autor.pais',
    ])
  })

  /** The control: nothing visible means every column, marked `output:`, as before. */
  test('with nothing visible, every column of every store reached is a DET', async ({ assert }) => {
    const bruto = fn(await countFixture(), 'GET /livros/bruto')

    assert.lengthOf(bruto.rationale.detSources, 11)
    assert.isTrue(bruto.rationale.detSources.every((source) => source.startsWith('output:')))
  })
})

test.group('output DETs: what cannot be read', () => {
  /**
   * `...this.resource.serialize()` emits whatever the model has. It counts 1 as a
   * floor — zero would price an unreadable output below a plain field — and it
   * is marked in the rationale so `fp:explain` says which DET is a floor.
   */
  test('an unreadable spread is one DET, marked opaque', async ({ assert }) => {
    const exportacao = fn(await countFixture(), 'GET /livros/exportacao')

    assert.equal(exportacao.det, 2)
    assert.deepEqual(exportacao.rationale.detSources.sort(), [
      'transformer:ExportacaoTransformer.<this.resource.serialize()> (opaque)',
      'transformer:ExportacaoTransformer.formato',
    ])
  })

  /** A silent floor is the worst defect this package can have. */
  test('and the count reports it, naming the transaction and the expression', async ({
    assert,
  }) => {
    const result = await countFixture()
    // the header is one line and each transaction the next: read the block
    const block = result.confidence.warnings.join('\n')

    assert.include(block, 'cannot read')
    assert.include(block, 'FLOOR')
    assert.include(
      block,
      'GET /livros/exportacao: ExportacaoTransformer.<this.resource.serialize()>'
    )
  })
})
