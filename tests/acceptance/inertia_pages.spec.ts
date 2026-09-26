import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * WHAT THE PAGE SHOWS IS WHAT LEAVES — plan 0.7 §B / 0.8 §D, counting-decisions §6
 *
 * A store handed to the page RAW leaves with the columns the page reads off it:
 * the controller says which store, the page (TSX or Edge) says which columns. The
 * reference (`fixtures/apps/inertia_pages/REFERENCE.md`) was written before the
 * code: every function keeps its points and changes what its DETs are made of.
 */
const REFERENCE = {
  total: 25,
  functions: {
    'Livro': { type: 'EIF', det: 9, refs: 1, fp: 5 },
    'GET /livros': { type: 'EO', det: 3, refs: 1, fp: 4 },
    'GET /livros/:param': { type: 'EO', det: 3, refs: 1, fp: 4 },
    'GET /livros/destaques': { type: 'EO', det: 9, refs: 1, fp: 4 },
    'GET /catalogo.xml': { type: 'EO', det: 2, refs: 1, fp: 4 },
    'GET /livros/ambiguo': { type: 'EO', det: 9, refs: 1, fp: 4 },
  },
} as const

let cached: Awaited<ReturnType<typeof analyze>> | undefined
const analyzed = async () => {
  if (!cached) cached = await analyze(appFixturePath('inertia_pages'))
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('pages: the reference, function by function', () => {
  test('every function matches the reference in type, DET, FTR and points', async ({ assert }) => {
    const { count: result } = await analyzed()

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

test.group('pages: what each DET is', () => {
  /** `livros.map((livro) => …)` reads `titulo`, `autor`, `ano` off each row */
  test('a raw store delivers the columns the page reads off its rows', async ({ assert }) => {
    const { count: result } = await analyzed()
    assert.deepEqual(fn(result, 'GET /livros').rationale.detSources.sort(), [
      'page:Livro.ano',
      'page:Livro.autor',
      'page:Livro.titulo',
    ])
  })

  /** `<Ficha livro={livro} />`: the child's props bind the row, its body is read the same way */
  test('a row handed to one child component is read there', async ({ assert }) => {
    const { count: result } = await analyzed()
    assert.deepEqual(fn(result, 'GET /livros/:param').rationale.detSources.sort(), [
      'page:Livro.isbn',
      'page:Livro.titulo',
      'param::id',
    ])
  })

  /** `@each(livro in livros)` with `{{ livro.titulo }}` and `{{ livro.isbn }}` */
  test('an Edge template is read by the same door', async ({ assert }) => {
    const { count: result } = await analyzed()
    assert.deepEqual(fn(result, 'GET /catalogo.xml').rationale.detSources.sort(), [
      'page:Livro.isbn',
      'page:Livro.titulo',
    ])
  })

  /** the data function is the file, whatever any page shows */
  test('the store keeps every column', async ({ assert }) => {
    const { count: result } = await analyzed()
    assert.equal(fn(result, 'Livro').det, 9)
  })
})

test.group('pages: what the reader cannot read, it says', () => {
  /** two levels of components: the reader stops at one, and the store leaves whole, in the open */
  test('a row passed two components deep counts every column and is reported', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    const destaques = fn(result, 'GET /livros/destaques')
    assert.equal(destaques.det, 9)
    assert.isTrue(destaques.rationale.detSources.every((s) => s.startsWith('output:Livro.')))

    const block = result.confidence.warnings.join('\n')
    assert.include(block, 'GET /livros/destaques')
    assert.include(block, '<Capa livro={…} />` is a second level of components')
  })

  /** `livros/ambiguo.tsx` and `livros/ambiguo/index.tsx` both answer: nothing is picked */
  test('a page name two files answer to is not read, and is reported', async ({ assert }) => {
    const { count: result } = await analyzed()
    assert.equal(fn(result, 'GET /livros/ambiguo').det, 9)
    const block = result.confidence.warnings.join('\n')
    assert.include(block, 'GET /livros/ambiguo')
    assert.include(block, 'livros/ambiguo')
  })
})
