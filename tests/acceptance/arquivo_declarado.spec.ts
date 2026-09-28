import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * A LOGICAL FILE THE ANALYSIS CANNOT SEE, DECLARED — plan 0.14 §D
 *
 * Roles kept by an authorization package, settings kept in a persistent cache,
 * appointments read from another system: data the user recognises, reached by paths the
 * analysis never follows. A reviewing team found them by hand in the list of routes not
 * counted. Nothing in the code changes: the configuration names the file, where its
 * structure comes from, and which calls read or write it. Reference first:
 * `fixtures/apps/arquivo_declarado/REFERENCE.md`.
 */
const root = appFixturePath('arquivo_declarado')

const LOGICAL_FILES = {
  Papel: {
    table: 'papeis',
    writes: [/\bpermissoes\.store\.(criarPapel|excluirPapel)$/],
    reads: [/\bpermissoes\.store\.listarPapeis$/],
    reason: 'roles the administrator maintains through the authorization package',
  },
  Configuracoes: {
    type: 'Configuracoes',
    exclude: ['atualizadoEm'],
    reads: ['ConfiguracoesService.get'],
    writes: ['ConfiguracoesService.atualizar'],
    reason: 'deadline and goal, set by the administrator, kept in a persistent cache',
  },
  Agendamento: {
    type: 'AgendamentoExterno',
    reads: ['AgendaService.listarPorPessoa'],
    reason: 'appointments read from the scheduling system',
  },
}

const EXPECTED = {
  'Papel': { type: 'ILF', det: 2, refs: 1, fp: 7 },
  'Configuracoes': { type: 'ILF', det: 2, refs: 1, fp: 7 },
  'Agendamento': { type: 'EIF', det: 3, refs: 1, fp: 5 },
  'GET /papeis': { type: 'EO', det: 1, refs: 1, fp: 4 },
  'POST /papeis': { type: 'EI', det: 1, refs: 1, fp: 3 },
  'DELETE /papeis/:param': { type: 'EI', det: 1, refs: 1, fp: 3 },
  'GET /configuracoes': { type: 'EO', det: 2, refs: 1, fp: 4 },
  'PUT /configuracoes': { type: 'EI', det: 2, refs: 1, fp: 3 },
  'POST /agendamentos/listar': { type: 'EO', det: 4, refs: 1, fp: 4 },
} as const

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('declared logical files: without a declaration', () => {
  test('0 FP, the six routes listed as not counted', async ({ assert }) => {
    const { count } = await analyze(root)
    assert.equal(count.totals.unadjusted, 0)
    assert.lengthOf(count.confidence.notCounted!, 6)
  })
})

test.group('declared logical files: declared', () => {
  test('every function matches the reference', async ({ assert }) => {
    const { count } = await analyze(root, { logicalFiles: LOGICAL_FILES })
    for (const [name, e] of Object.entries(EXPECTED)) {
      const counted = fn(count, name)
      assert.equal(counted.type, e.type, `${name}: type`)
      assert.equal(counted.det, e.det, `${name}: DET`)
      assert.equal(counted.refs, e.refs, `${name}: FTR/RET`)
      assert.equal(counted.points, e.fp, `${name}: FP`)
    }
    assert.equal(count.totals.unadjusted, 40)
    assert.lengthOf(count.confidence.notCounted!, 0)
  })

  test('the DETs say where they came from', async ({ assert }) => {
    const { count } = await analyze(root, { logicalFiles: LOGICAL_FILES })
    assert.sameMembers(fn(count, 'Configuracoes').rationale.detSources, [
      'declared-type:Configuracoes.prazoDias',
      'declared-type:Configuracoes.metaPct',
    ])
    assert.sameMembers(fn(count, 'Papel').rationale.detSources, [
      'generated-schema:papeis.nome',
      'generated-schema:papeis.guarda',
    ])
  })

  test('the report lists the declared files, their volume and who reaches them', async ({
    assert,
  }) => {
    const { count } = await analyze(root, { logicalFiles: LOGICAL_FILES })
    assert.include(
      count.confidence.warnings,
      '3 logical file(s) declared in logicalFiles: Agendamento (type AgendamentoExterno, 3 DET); ' +
        'Configuracoes (type Configuracoes, 2 DET); Papel (table papeis, 2 DET from the generated schema) ' +
        '— 19 FP as data functions, reached by declaration from 6 transaction(s)'
    )
  })
})

test.group('declared logical files: a declaration without effect', () => {
  test('an entry that matches nothing, a type nobody declares: said, and nothing counted for them', async ({
    assert,
  }) => {
    const { count } = await analyze(root, {
      logicalFiles: {
        Papel: { ...LOGICAL_FILES.Papel, reads: [...LOGICAL_FILES.Papel.reads, /listarTodos/] },
        Fantasma: { type: 'TipoQueNaoExiste', reads: ['Nada.aqui'], reason: 'a typo' },
      },
    })
    const warnings = count.confidence.warnings
    assert.include(
      warnings,
      'logicalFiles.Papel.reads[1] (/listarTodos/) matched nothing: it had no effect'
    )
    assert.include(
      warnings,
      "logicalFiles.Fantasma: the application declares no type 'TipoQueNaoExiste' — not counted"
    )
    assert.isUndefined(count.functions.find((f) => f.name === 'Fantasma'))
  })
})
