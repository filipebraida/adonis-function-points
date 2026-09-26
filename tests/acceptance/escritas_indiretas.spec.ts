import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * A WRITE BINDS TO WHAT THE VARIABLE IS — plan 0.8 §A/§B, counting-decisions §3
 *
 * The reviewed application's dominant shape is "the controller loads, the action
 * alters": the written instance arrives by parameter, by destructuring, by a
 * service's return, by a loop over a relation, or the writer is a service the
 * container resolved. Every one of those writes was invisible, and the coverage
 * said 99.5%. The reference (`fixtures/apps/escritas_indiretas/REFERENCE.md`)
 * was written before the code, with what afp@1.6.0 printed beside it: 57 FP, five
 * EIs sold as EOs, two ILFs mistaken for EIFs, one ILF gone, zero unresolved.
 */
const REFERENCE = {
  total: 87,
  unresolved: 1,
  functions: {
    'Documento': { type: 'ILF', det: 5, refs: 1, fp: 7 },
    'Pasta': { type: 'ILF', det: 1, refs: 1, fp: 7 },
    'Sessao': { type: 'ILF', det: 2, refs: 1, fp: 7 },
    'Usuario': { type: 'ILF', det: 1, refs: 1, fp: 7 },
    'Historico': { type: 'ILF', det: 3, refs: 1, fp: 7 },
    'Notificacao': { type: 'ILF', det: 2, refs: 1, fp: 7 },
    'PATCH /documentos/:param': { type: 'EI', det: 2, refs: 1, fp: 3 },
    'DELETE /documentos/:param': { type: 'EI', det: 2, refs: 1, fp: 3 },
    'POST /documentos/:param/arquivar': { type: 'EI', det: 1, refs: 2, fp: 3 },
    'POST /pastas/:param/limpar': { type: 'EI', det: 1, refs: 2, fp: 3 },
    'POST /documentos/:param/atribuir': { type: 'EI', det: 2, refs: 3, fp: 4 },
    'POST /documentos/:param/notificar': { type: 'EI', det: 1, refs: 2, fp: 3 },
    'POST /documentos/:param/carimbar': { type: 'EO', det: 7, refs: 1, fp: 4 },
    'POST /documentos': { type: 'EI', det: 2, refs: 1, fp: 3 },
    'POST /documentos/:param/sessao': { type: 'EI', det: 1, refs: 2, fp: 3 },
    'POST /pastas/:param/marcar': { type: 'EI', det: 1, refs: 2, fp: 3 },
    'POST /perfil': { type: 'EI', det: 1, refs: 1, fp: 3 },
    'POST /documentos/:param/pasta': { type: 'EI', det: 2, refs: 2, fp: 3 },
    'POST /documentos/:param/duplicar': { type: 'EI', det: 1, refs: 1, fp: 3 },
    'GET /documentos/:param/exportar': { type: 'EO', det: 2, refs: 1, fp: 4 },
  },
} as const

let cached: Awaited<ReturnType<typeof analyze>> | undefined
const analyzed = async () => {
  if (!cached) cached = await analyze(appFixturePath('escritas_indiretas'))
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('indirect writes: the reference, function by function', () => {
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

test.group('indirect writes: each shape binds', () => {
  test('a destructured parameter typed by a named interface, same file or imported', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    assert.equal(fn(result, 'PATCH /documentos/:param').type, 'EI', 'RenomearInput, same file')
    assert.equal(
      fn(result, 'DELETE /documentos/:param').type,
      'EI',
      'ExcluirInput imported, destructured after'
    )
  })

  /** `Promise<Sessao | null>` on the followed method names the store; nothing is guessed */
  test('the return type of a followed method binds the variable it is assigned to', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    const arquivar = fn(result, 'POST /documentos/:param/arquivar')
    assert.equal(arquivar.type, 'EI')
    assert.includeMembers(arquivar.rationale.refSources, ['reaches:Documento', 'reaches:Sessao'])
    assert.equal(fn(result, 'Sessao').type, 'ILF', 'written through what the service returned')
  })

  test('a `for…of` over a preloaded relation binds the loop variable to the relation target', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    const limpar = fn(result, 'POST /pastas/:param/limpar')
    assert.equal(limpar.type, 'EI')
    assert.includeMembers(limpar.rationale.refSources, ['reaches:Documento', 'reaches:Pasta'])
  })

  /** the container hands back an instance of X: followed like a constructor-injected property */
  test('`await app.container.make(X)` binds the local to X, and its methods are followed', async ({
    assert,
  }) => {
    const { count: result, inventory } = await analyzed()
    const atribuir = fn(result, 'POST /documentos/:param/atribuir')
    assert.equal(atribuir.type, 'EI')
    assert.includeMembers(atribuir.rationale.refSources, [
      'reaches:Documento',
      'reaches:Historico',
      'reaches:Usuario',
    ])
    assert.equal(fn(result, 'Historico').type, 'ILF', 'reached at last')

    const behavior = inventory.behaviors.find(
      (b) => b.entryPointId === 'POST /documentos/:id/atribuir'
    )!
    assert.isTrue(
      behavior.trace.some(
        (t) => t.file.endsWith('atribuicao_service.ts') && t.member === 'atribuir'
      ),
      'the service method is on the trace'
    )
  })
})

test.group('indirect writes: the shapes the first recount named', () => {
  test('a conditional or a default over the same store binds; the guard user and a relation off a row bind', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    assert.equal(fn(result, 'POST /documentos').type, 'EI', 'find(id) : new Documento()')
    assert.equal(fn(result, 'POST /documentos/:param/sessao').type, 'EI', 'first() ?? new Sessao()')
    assert.equal(
      fn(result, 'POST /perfil').type,
      'EI',
      'auth.getUserOrFail() is Usuario, per config/auth.ts'
    )
    assert.equal(fn(result, 'Usuario').type, 'ILF')
    assert.equal(
      fn(result, 'POST /documentos/:param/pasta').type,
      'EI',
      'documento.pasta is a Pasta'
    )
    assert.equal(fn(result, 'Pasta').type, 'ILF')
  })

  test('a callback parameter over a relation, and an unannotated helper returning a store, bind', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    const marcar = fn(result, 'POST /pastas/:param/marcar')
    assert.equal(marcar.type, 'EI')
    assert.includeMembers(marcar.rationale.refSources, ['reaches:Documento', 'reaches:Pasta'])
    assert.equal(
      fn(result, 'POST /documentos/:param/duplicar').type,
      'EI',
      'every return is Documento.create(…)'
    )
  })
})

test.group('indirect writes: what the analysis cannot read, it says', () => {
  /**
   * The team's complaint was not the wrong number; it was the 99.5% coverage beside
   * it. A `save()` on a receiver nobody can type is an unresolved call now.
   */
  test('a write on an unknown receiver is an unresolved call, and lowers coverage', async ({
    assert,
  }) => {
    const { count: result, inventory } = await analyzed()

    assert.equal(result.confidence.unresolvedCalls, REFERENCE.unresolved)
    const carimbar = inventory.behaviors.find(
      (b) => b.entryPointId === 'POST /documentos/:id/carimbar'
    )!
    assert.lengthOf(carimbar.unresolved, 1)
    assert.equal(carimbar.unresolved[0].expression, 'alvo.save')
    assert.include(
      carimbar.unresolved[0].reason,
      'write on a receiver whose type the analysis cannot read'
    )
    assert.isBelow(inventory.coverage.ratio, 1)
    assert.equal(
      fn(result, 'POST /documentos/:param/carimbar').type,
      'EO',
      'nothing readable was written'
    )
  })

  /**
   * The team that reviewed 0.8 could not SEE the line: both reports printed a total,
   * and two different totals. One list, one number, in the inventory and in the count.
   */
  test('the unresolved sites are listed, once each, and both reports agree on the number', async ({
    assert,
  }) => {
    const { count: result, inventory } = await analyzed()

    assert.lengthOf(inventory.unresolved, 1)
    const [site] = inventory.unresolved
    assert.equal(site.expression, 'alvo.save')
    assert.match(site.file, /documentos_controller\.ts$/)
    assert.isAbove(site.line, 0)
    assert.equal(site.transactions, 1)
    assert.deepEqual(result.confidence.unresolved, inventory.unresolved)
    assert.equal(result.confidence.unresolvedCalls, inventory.coverage.unresolvedCalls)
  })

  /** pdf-lib's `PDFDocument#save()`: a package's object, not a store — reported on a real app, wrongly */
  test('a write-named method on a package object is not reported', async ({ assert }) => {
    const { inventory } = await analyzed()
    const exportar = inventory.behaviors.find(
      (b) => b.entryPointId === 'GET /documentos/:id/exportar'
    )!
    assert.lengthOf(exportar.unresolved, 0)
  })

  /** every other transaction is fully read: the new rule adds no noise where the type is known */
  test('a write on a typed receiver is not reported', async ({ assert }) => {
    const { inventory } = await analyzed()
    const others = inventory.behaviors.filter(
      (b) => b.entryPointId !== 'POST /documentos/:id/carimbar'
    )
    for (const behavior of others) assert.lengthOf(behavior.unresolved, 0, behavior.entryPointId)
  })
})
