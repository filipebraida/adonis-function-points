import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * A CALL INTO A PACKAGE IS OUTSIDE THE BOUNDARY — plan 0.11 §A, counting-decisions §4
 *
 * An authorisation service from a package, a variant of an attachment whose column
 * type comes from a package, a content collection built by a package's factory: none is
 * code the analysis should follow, so none is a gap it failed to follow. Noted, not
 * unresolved; coverage measures what of the APPLICATION the walk could not follow. The
 * reference (`fixtures/apps/fronteira_pacote/REFERENCE.md`) was written first: 0.10.1
 * printed the same 23 FP with four unresolved calls.
 */
const REFERENCE = {
  total: 27,
  functions: {
    'Pedido': { type: 'ILF', det: 2, refs: 1, fp: 7 },
    'Usuario': { type: 'EIF', det: 1, refs: 1, fp: 5 },
    'GET /pedidos': { type: 'EO', det: 5, refs: 2, fp: 4 },
    'GET /pedidos/resumo': { type: 'EO', det: 2, refs: 1, fp: 4 },
    'POST /pedidos': { type: 'EI', det: 1, refs: 1, fp: 3 },
    // afp@1.10.0: the raw query builder is a data access (plan 0.12 §B)
    'GET /painel/contagem': { type: 'EO', det: 1, refs: 1, fp: 4 },
  },
} as const

let cached: Awaited<ReturnType<typeof analyze>> | undefined
const analyzed = async () => {
  if (!cached) cached = await analyze(appFixturePath('fronteira_pacote'))
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('package boundary: the reference, function by function', () => {
  test('no point moves', async ({ assert }) => {
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

test.group('nothing falls out in silence', () => {
  /** a management area of a reviewed application fell out this way for three releases */
  test('routes that reach no store are listed; the builder route is counted and off the list', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    const block = result.confidence.warnings.join('\n')
    assert.include(
      block,
      '1 route(s) with a handler reach no data store the analysis sees, and are not counted (counting-decisions §1). Most are static pages, redirects and forms:'
    )
    assert.include(block, '  GET /sobre')
    assert.notInclude(block, 'GET /painel/contagem')
    assert.notInclude(block, '⚑')
  })

  test('the coverage line names the entry point without a handler', async ({ assert }) => {
    const { count: result } = await analyzed()
    assert.equal(result.confidence.entryPointsWithoutHandler, 1)
    assert.deepEqual(result.confidence.withoutHandler, ['GET /ajuda'])
  })
})

test.group('package boundary: notes, not gaps', () => {
  test('a call into a package is a note — an injected package type, a package-typed column, a package factory', async ({
    assert,
  }) => {
    const { inventory } = await analyzed()
    const notes = inventory.notes.filter((n) => n.includes('call into'))
    assert.lengthOf(notes, 3, inventory.notes.join('\n'))
    for (const expected of [
      'GET /pedidos: call into @acme/permissoes (this.permissoes.pode) — outside the boundary; what a package does with its own tables is technical (§4), what it hands back is a value',
      'GET /pedidos: call into @acme/anexos/types (this.resource.capa?.variante) — outside the boundary;',
      'GET /pedidos: call into @acme/conteudo (guias.carregar) — outside the boundary;',
    ]) {
      assert.isTrue(
        notes.some((n) => n.startsWith(expected)),
        `missing: ${expected}\n${notes.join('\n')}`
      )
    }
  })

  /** an interface of the application with no implementation found is a gap of the application */
  test('a receiver typed by the application stays an unresolved call', async ({ assert }) => {
    const { count: result, inventory } = await analyzed()
    assert.equal(result.confidence.unresolvedCalls, 1)
    const [gap] = inventory.unresolved
    assert.match(gap.file, /gerador_de_relatorios\.ts$/)
    assert.include(gap.reason, 'interface method: the implementation is injected at runtime')
  })

  /** the value a package hands back is read as a value — the same as before */
  test('what the package hands back is still a delivered value, reported when unreadable', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    assert.include(
      result.confidence.warnings.join('\n'),
      "GET /pedidos: ajuda.<guias.carregar('pedidos')>"
    )
  })
})
