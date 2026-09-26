import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * AN ACE COMMAND IS AN ELEMENTARY PROCESS — plan 0.7 §C, counting-decisions §5
 *
 * IFPUG counts batch processes an operator starts. The reference
 * (`fixtures/apps/ace_commands/REFERENCE.md`) was written before the code, with
 * what `afp@1.5.0` says beside it: 9 FP, because commands did not exist and the
 * table they maintain looked like an EIF.
 */
const REFERENCE = {
  total: 26,
  functions: {
    'Noticia': { type: 'ILF', det: 5, refs: 1, fp: 7 },
    'Assinante': { type: 'EIF', det: 3, refs: 1, fp: 5 },
    'GET /noticias': { type: 'EO', det: 5, refs: 1, fp: 4 },
    'ace noticias:importar': { type: 'EI', det: 3, refs: 1, fp: 3 },
    'ace assinantes:relatorio': { type: 'EO', det: 4, refs: 1, fp: 4 },
    'ace gerar:noticias': { type: 'EI', det: 1, refs: 1, fp: 3 },
  },
} as const

let cached: Awaited<ReturnType<typeof analyze>> | undefined
const analyzed = async () => {
  if (!cached) cached = await analyze(appFixturePath('ace_commands'))
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('ace commands: the reference, function by function', () => {
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

  /** a scaffolder writes files and reaches no store: no transaction to identify (AFP §6.5.3) */
  test('a command that reaches no data function is not a transaction', async ({ assert }) => {
    const { count: result, inventory } = await analyzed()

    assert.isTrue(
      inventory.entryPoints.some((e) => e.kind === 'command' && e.signature === 'make:widget')
    )
    assert.isUndefined(result.functions.find((f) => f.name === 'ace make:widget'))
  })
})

test.group('ace commands: what each DET is', () => {
  /** the flags are the input, named as the operator types them — `flagName` wins over the property */
  test('input DETs are the @flags and @args declared, by the name typed', async ({ assert }) => {
    const { count: result } = await analyzed()

    assert.deepEqual(fn(result, 'ace noticias:importar').rationale.detSources, [
      'flag:atualizar',
      'flag:desde',
      'flag:limite',
    ])
    assert.include(fn(result, 'ace assinantes:relatorio').rationale.detSources, 'flag:ativos')
    assert.notInclude(
      fn(result, 'ace assinantes:relatorio').rationale.detSources.join(' '),
      'somenteAtivos'
    )
  })

  /** a command name has a colon; it is not a route pattern with a parameter */
  test('the colon in a command name is not a route parameter', async ({ assert }) => {
    const { count: result } = await analyzed()
    for (const f of result.functions.filter((x) => x.name.startsWith('ace ')))
      assert.notInclude(f.rationale.detSources.join(' '), 'param:', f.name)
  })

  /**
   * Printing is delivery: the table's rows deliver the fields read off them, by
   * name; the count is one value; the headers are labels and count nothing.
   */
  test('what a report prints is what leaves: fields by name, a count once, no labels', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    const sources = fn(result, 'ace assinantes:relatorio').rationale.detSources

    assert.includeMembers(sources, ['render:nome', 'render:email', 'render:length'])
    assert.notInclude(sources.join(' '), '<value>', 'the headers are not fields')
    assert.notInclude(
      sources.join(' '),
      'output:Assinante',
      'not the whole table: what was printed'
    )
  })
})

test.group('ace commands: the report and the way out', () => {
  test('counted commands are listed with their FP, a generator with its hint', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    const block = result.confidence.warnings.join('\n')

    assert.include(block, '3 ace command(s) counted as elementary processes')
    assert.include(block, 'ace noticias:importar: EI 3 FP')
    assert.include(block, 'ace gerar:noticias: EI 3 FP — imports @faker-js/faker')
    assert.include(block, 'boundary.ignoreEntryPoints')
  })

  /** the CPM does not count the team's tools; the code cannot tell them apart; a person can */
  test('`boundary.ignoreEntryPoints` by command name excludes a development tool', async ({
    assert,
  }) => {
    const { count: result } = await analyze(appFixturePath('ace_commands'), {
      boundary: { ignoreEntryPoints: ['gerar:noticias'] },
    })

    assert.isUndefined(result.functions.find((f) => f.name === 'ace gerar:noticias'))
    assert.equal(result.totals.unadjusted, REFERENCE.total - 3)
    assert.equal(fn(result, 'Noticia').type, 'ILF', 'still maintained by the importer')
  })
})

test.group('jobs nobody dispatches: reported, not counted (plan §D)', () => {
  /** a job the import command dispatches is part of that EI — nothing to say about it */
  test('a job a transaction reaches is not reported', async ({ assert }) => {
    const { count: result } = await analyzed()
    assert.notInclude(result.confidence.warnings.join('\n'), 'IndexarNoticiaJob')
  })

  /** the code cannot tell a scheduled process from dead code; the report says which it saw */
  test('a scheduled job and an orphan job are named, each with what was seen', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()
    const block = result.confidence.warnings.join('\n')

    assert.include(block, '2 job(s) reached by no transaction')
    assert.include(
      block,
      'PodarNoticiasJob (app/jobs/podar_noticias_job.ts): scheduled from start/scheduler.ts, outside every transaction'
    )
    assert.include(
      block,
      'EnviarBoletimJob (app/jobs/enviar_boletim_job.ts): dispatched by nothing in the application'
    )
  })

  /** inventing an elementary process is the error this package exists to avoid */
  test('neither job becomes a function; the store the scheduled one writes is still maintained here', async ({
    assert,
  }) => {
    const { count: result } = await analyzed()

    assert.isUndefined(result.functions.find((f) => /PodarNoticias|EnviarBoletim/.test(f.name)))
    assert.equal(result.totals.unadjusted, REFERENCE.total)
    assert.equal(fn(result, 'Noticia').type, 'ILF')
  })
})
