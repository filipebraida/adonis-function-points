import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * A TABLE NO MODEL DECLARES, NAMED IN THE BOUNDARY — plan 0.13 §B
 *
 * Nobody writes a model so that a counter can see a table. The structure is in the
 * generated schema already; what is the user's data, another system's or technical is
 * a business decision, and it goes in the configuration. The reference
 * (`fixtures/apps/fronteira_tabela/REFERENCE.md`) was written first; afp@1.10.0 printed
 * 18 FP and three unresolved calls.
 */
type Expected = Record<string, { type: string; det: number; refs: number; fp: number }>

const COMMON: Expected = {
  'Pedido': { type: 'ILF', det: 2, refs: 1, fp: 7 },
  'GET /pedidos': { type: 'EO', det: 2, refs: 1, fp: 4 },
  'POST /pedidos': { type: 'EI', det: 1, refs: 1, fp: 3 },
}

const run = (boundary: Record<string, string[]> = {}) =>
  analyze(appFixturePath('fronteira_tabela'), { boundary })

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

const matches = (assert: any, result: CountResult, expected: Expected, total: number) => {
  for (const [name, e] of Object.entries(expected)) {
    const counted = fn(result, name)
    assert.equal(counted.type, e.type, `${name}: type`)
    assert.equal(counted.det, e.det, `${name}: DET`)
    assert.equal(counted.refs, e.refs, `${name}: FTR/RET`)
    assert.equal(counted.points, e.fp, `${name}: FP`)
  }
  assert.equal(result.totals.unadjusted, total)
}

test.group('boundary table: without a declaration nothing changes', () => {
  test('18 FP, three unresolved calls pointing at the boundary keys', async ({ assert }) => {
    const { count: result, inventory } = await run()
    matches(
      assert,
      result,
      { ...COMMON, 'GET /painel/resumo': { type: 'EO', det: 1, refs: 1, fp: 4 } },
      18
    )
    assert.equal(result.confidence.unresolvedCalls, 3)
    for (const site of inventory.unresolved)
      assert.include(site.reason, 'Say what it is in the configuration: boundary.business')
    assert.isUndefined(result.functions.find((f) => f.name === 'Registro'))
  })
})

test.group('boundary table: business', () => {
  test('the generated schema gives the store; the application writes it: an ILF', async ({
    assert,
  }) => {
    const { count: result } = await run({ business: ['registros'] })
    matches(
      assert,
      result,
      {
        ...COMMON,
        'Registro': { type: 'ILF', det: 4, refs: 1, fp: 7 },
        'GET /painel/registros': { type: 'EO', det: 3, refs: 1, fp: 4 },
        'GET /painel/resumo': { type: 'EO', det: 2, refs: 2, fp: 4 },
        'POST /painel/registros': { type: 'EI', det: 2, refs: 1, fp: 3 },
      },
      32
    )
    assert.equal(result.confidence.unresolvedCalls, 0)
    assert.includeMembers(fn(result, 'Registro').rationale.detSources, [
      'generated-schema:registros.pedidoId',
      'generated-schema:registros.acao',
      'generated-schema:registros.autor',
      'generated-schema:registros.detalhe',
    ])
  })

  test('the table counted by declaration is said, with where its columns came from', async ({
    assert,
  }) => {
    const { count: result } = await run({ business: ['registros'] })
    assert.include(
      result.confidence.warnings,
      '1 table(s) no model declares, counted by declaration in boundary.business: Registro (registros, 4 DET from the generated schema)'
    )
  })
})

test.group('boundary table: externally maintained', () => {
  test('an EIF as declared — and the write that contradicts it is reported', async ({ assert }) => {
    const { count: result } = await run({ externallyMaintained: ['registros'] })
    assert.equal(fn(result, 'Registro').type, 'EIF')
    assert.equal(fn(result, 'Registro').points, 5)
    assert.equal(result.totals.unadjusted, 30)
    assert.equal(result.confidence.unresolvedCalls, 0)
    assert.include(
      result.confidence.warnings,
      'declared in boundary.externallyMaintained, but this application writes it: Registro (registros) — POST /painel/registros'
    )
  })
})

test.group('boundary table: infrastructure', () => {
  test('excluded, no longer a gap — and the screens that show it are reported', async ({
    assert,
  }) => {
    const { count: result } = await run({ infrastructure: ['registros'] })
    matches(
      assert,
      result,
      { ...COMMON, 'GET /painel/resumo': { type: 'EO', det: 1, refs: 1, fp: 4 } },
      18
    )
    assert.equal(result.confidence.unresolvedCalls, 0)
    assert.isUndefined(result.functions.find((f) => f.name === 'GET /painel/registros'))
    assert.include(
      result.confidence.warnings,
      'declared in boundary.infrastructure, but it is shown to the user by: Registro (registros) — GET /painel/registros, GET /painel/resumo'
    )
  })
})

test.group('boundary table: no structure known', () => {
  test('a declared table no generated class describes stays a gap, and says why', async ({
    assert,
  }) => {
    const { count: result } = await run({ business: ['registros', 'arquivados'] })
    assert.include(
      result.confidence.warnings,
      "declared in boundary.business: 'arquivados' — no model and no generated-schema class describes it, so the count cannot know its columns"
    )
    assert.equal(result.totals.unadjusted, 32)
  })
})
