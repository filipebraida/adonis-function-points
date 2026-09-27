import { test } from '@japa/runner'

import { ignoreCalls } from '../../src/inventory/resolvers/index.js'
import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * THE RAW QUERY BUILDER IS A DATA ACCESS — plan 0.12 §B, counting-decisions §6
 *
 * `db.from('pedidos')…` is an access to the store whose table is `pedidos`. A reviewed
 * application's management area was written this way and fell out of the count in
 * silence for three releases. The reference (`fixtures/apps/query_builder_cru/
 * REFERENCE.md`) was written first; afp@1.9.0 printed 0 FP and eight marked routes.
 */
const REFERENCE = {
  total: 42,
  functions: {
    'Pedido': { type: 'ILF', det: 5, refs: 1, fp: 7 },
    'Usuario': { type: 'EIF', det: 3, refs: 1, fp: 5 },
    'GET /painel': { type: 'EO', det: 1, refs: 1, fp: 4 },
    'GET /painel/equipe': { type: 'EO', det: 2, refs: 1, fp: 4 },
    'GET /painel/carga': { type: 'EO', det: 2, refs: 2, fp: 4 },
    'POST /painel/:param/reatribuir': { type: 'EI', det: 2, refs: 1, fp: 3 },
    'POST /painel/lote': { type: 'EI', det: 1, refs: 1, fp: 3 },
    'GET /painel/pares': { type: 'EO', det: 1, refs: 2, fp: 4 },
    'GET /painel/sql': { type: 'EO', det: 2, refs: 1, fp: 4 },
    // 0.13 §C: the subquery a local function returns, its joinRaw read
    'GET /painel/acoes': { type: 'EO', det: 1, refs: 2, fp: 4 },
  },
} as const

let cached: Awaited<ReturnType<typeof analyze>> | undefined
const analyzed = async () => {
  if (!cached) cached = await analyze(appFixturePath('query_builder_cru'))
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('raw query builder: the reference, function by function', () => {
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
  })
})

test.group('raw query builder: what each DET is', () => {
  test('an aggregate is one DET; named columns are those columns; a join adds its store', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    // `const [{ total }] = await db.from(…).count('* as total')`: the one scalar, delivered by name
    assert.deepEqual(fn(result, 'GET /painel').rationale.detSources, ['render:total'])
    assert.include(
      fn(result, 'GET /painel/sql').rationale.detSources,
      'aggregate:Pedido (a count or an existence check: one scalar)'
    )
    assert.deepEqual(fn(result, 'GET /painel/equipe').rationale.detSources.sort(), [
      'select:Usuario.email',
      'select:Usuario.nome',
    ])
    const carga = fn(result, 'GET /painel/carga')
    assert.includeMembers(carga.rationale.refSources, ['reaches:Pedido', 'reaches:Usuario'])
    assert.include(carga.rationale.detSources, 'select:Usuario.nome')
  })

  test('a write through the builder or the transaction client makes an EI', async ({ assert }) => {
    const { count: result, inventory } = await analyzed()
    assert.equal(fn(result, 'POST /painel/:param/reatribuir').type, 'EI')
    assert.equal(fn(result, 'POST /painel/lote').type, 'EI')
    const lote = inventory.behaviors.find((b) => b.entryPointId === 'POST /painel/lote')!
    assert.deepEqual(lote.writtenStores, ['Pedido'])
  })

  /** the pivot of a declared many-to-many is the relation: both stores are FTRs */
  test('a pivot table is the relation between its two stores', async ({ assert }) => {
    const { count: result } = await analyzed()
    assert.includeMembers(fn(result, 'GET /painel/pares').rationale.refSources, [
      'reaches:Pedido',
      'reaches:Usuario',
    ])
  })

  /** plan 0.13 §C: `db.from(acoesQuery(id))`, `acoesQuery` returning a builder with a `joinRaw` */
  test('a subquery a local function returns is read as its builder, joinRaw included', async ({
    assert,
  }) => {
    const { count: result, inventory } = await analyzed()
    assert.includeMembers(fn(result, 'GET /painel/acoes').rationale.refSources, [
      'reaches:Pedido',
      'reaches:Usuario',
    ])
    assert.notInclude(inventory.unresolved.map((u) => u.expression).join('\n'), 'acoesQuery')
  })

  test('literal SQL names its table and its columns', async ({ assert }) => {
    const { count: result } = await analyzed()
    const sql = fn(result, 'GET /painel/sql')
    assert.deepEqual(sql.rationale.refSources, ['reaches:Pedido'])
    assert.include(sql.rationale.detSources, 'select:Pedido.status')
  })
})

test.group('raw query builder: what the count does not know, it says', () => {
  /** `configuracoes` has no model: no store the count knows — an unresolved call, never silence */
  test('a table no model declares is an unresolved call, and the route is not counted', async ({
    assert,
  }) => {
    const { count: result, inventory } = await analyzed()
    assert.isUndefined(result.functions.find((f) => f.name === 'GET /painel/config'))
    assert.isUndefined(result.functions.find((f) => f.name === 'GET /painel/arquivo'))
    assert.equal(result.confidence.unresolvedCalls, 2)
    const reasons = inventory.unresolved.map((u) => u.reason)
    assert.isTrue(
      reasons.some((r) => r.includes('raw query on a table no model declares: configuracoes')),
      reasons.join('\n')
    )
    assert.isTrue(
      reasons.some((r) =>
        r.includes(
          'raw query over an expression the analysis cannot read (tabela): a subquery or a computed table name — what it reaches is not counted here'
        )
      ),
      reasons.join('\n')
    )
  })

  /** a table the team knows is a package's, declared data-free, is believed like any other call */
  test('ignoreCalls silences a raw query on a table no model declares', async ({ assert }) => {
    const { count: result, inventory } = await analyze(appFixturePath('query_builder_cru'), {
      resolvers: {
        call: [ignoreCalls({ name: 'settings table', matching: /from\('configuracoes'\)/ })],
      },
    })
    assert.equal(result.confidence.unresolvedCalls, 1)
    assert.notInclude(inventory.unresolved.map((u) => u.reason).join('\n'), 'configuracoes')
  })

  /** every builder call is read now: the ⚑ mark of §A has nothing left to mark */
  test('no route is marked as passing through a builder the analysis does not read', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    assert.notInclude(result.confidence.warnings.join('\n'), '⚑')
    // the one store-less route left is the table no model declares, listed plain
    assert.include(result.confidence.warnings.join('\n'), '  GET /painel/config')
    assert.include(result.confidence.warnings.join('\n'), '  GET /painel/arquivo')
  })
})
