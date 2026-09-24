import { test } from '@japa/runner'

import { AEP_FACTORS, IncomparableRulesetsError, diffCounts } from '../../src/albrecht/diff.js'
import type { CountResult, CountedFunction } from '../../src/types.js'

/** contagem sintética: o diff é aritmética sobre identidade, e testar assim isola */
const fn = (over: Partial<CountedFunction> = {}): CountedFunction => ({
  id: 'tx:POST /books',
  name: 'POST /books',
  module: 'app',
  type: 'EI',
  det: 3,
  refs: 1,
  complexity: 'low',
  points: 3,
  scopeHash: 'h1',
  rationale: { rule: 'afp:6.5.3', detSources: [], refSources: [] },
  ...over,
})

const result = (functions: CountedFunction[], version = '1.0.0'): CountResult => ({
  ruleset: 'afp',
  rulesetVersion: version,
  functions,
  totals: {
    unadjusted: functions.reduce((t, f) => t + f.points, 0),
    byType: {
      ILF: { count: 0, points: 0 },
      EIF: { count: 0, points: 0 },
      EI: { count: 0, points: 0 },
      EO: { count: 0, points: 0 },
      EQ: { count: 0, points: 0 },
    },
    byModule: {},
  },
  confidence: { unresolvedCalls: 0, entryPointsWithoutHandler: 0, warnings: [] },
})

const entryFor = (diff: ReturnType<typeof diffCounts>, name: string) =>
  diff.entries.find((e) => e.function.name === name)

test.group('diff: classificação da mudança', () => {
  test('função nova é inclusão', async ({ assert }) => {
    const diff = diffCounts(result([]), result([fn()]))
    assert.equal(entryFor(diff, 'POST /books')!.change, 'added')
  })

  test('função que desapareceu é exclusão', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([]))
    assert.equal(entryFor(diff, 'POST /books')!.change, 'removed')
  })

  test('escopo alterado é alteração', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn({ scopeHash: 'h2' })]))
    assert.equal(entryFor(diff, 'POST /books')!.change, 'changed')
  })

  test('tamanho funcional alterado é alteração', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn({ det: 9, points: 4 })]))
    assert.equal(entryFor(diff, 'POST /books')!.change, 'changed')
  })

  /**
   * O hash é de AST normalizado, sem whitespace nem comentário — então rodar o
   * prettier produz o MESMO hash e a função não muda de estado.
   *
   * Sem isso, formatar o projeto viraria fatura.
   */
  test('função idêntica não é alteração', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn()]))

    assert.equal(entryFor(diff, 'POST /books')!.change, 'unchanged')
    assert.equal(diff.totals.unchanged.count, 1)
  })

  /**
   * counting-decisions §5: a identidade é `(verbo, padrão normalizado)`. Mover o
   * controller de módulo é refatoração, não exclusão + inclusão — que faturaria
   * em dobro.
   */
  test('mover o controller de módulo é alteração, não exclusão + inclusão', async ({ assert }) => {
    const diff = diffCounts(
      result([fn({ module: 'catalog' })]),
      result([fn({ module: 'admin/catalog' })])
    )

    assert.lengthOf(diff.entries, 1)
    assert.equal(diff.entries[0].change, 'unchanged')
    assert.equal(diff.totals.added.count, 0)
    assert.equal(diff.totals.removed.count, 0)
  })

  /** Renomear o parâmetro da rota não muda a função que o usuário vê. */
  test('renomear parâmetro não produz mudança', async ({ assert }) => {
    const antes = fn({ id: 'tx:DELETE /books/:param', name: 'DELETE /books/:param' })
    const diff = diffCounts(result([antes]), result([antes]))

    assert.equal(diff.entries[0].change, 'unchanged')
  })
})

test.group('diff: fatores e faturamento', () => {
  /** AEP §6.5: adicionada vale 1, excluída vale 0,4. */
  test('usa os âncoras da AEP por default', async ({ assert }) => {
    assert.equal(AEP_FACTORS.added, 1)
    assert.equal(AEP_FACTORS.removed, 0.4)
    assert.equal(AEP_FACTORS.unchanged, 0)
  })

  test('função excluída é cobrada a 40%', async ({ assert }) => {
    const diff = diffCounts(result([fn({ points: 10 })]), result([]))
    assert.equal(diff.billable, 4)
  })

  test('função inalterada não entra na fatura', async ({ assert }) => {
    const diff = diffCounts(result([fn({ points: 10 })]), result([fn({ points: 10 })]))
    assert.equal(diff.billable, 0)
  })

  test('os fatores são sobrescrevíveis, para preset de contrato', async ({ assert }) => {
    const diff = diffCounts(result([fn({ points: 10 })]), result([]), {
      factors: { removed: 0.2 },
    })
    assert.equal(diff.billable, 2)
  })

  /**
   * A AEP grada o fator de alteração de 0,25 a 1,75 pela variação de Effort
   * Complexity, que exige complexidade ciclomática — não medida aqui.
   *
   * Contar 1 superestima, e o resultado tem que AVISAR. Cobrar valor cheio por
   * uma alteração de uma linha sem dizer nada seria indefensável.
   */
  test('alteração cobrada a 100% emite aviso', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn({ scopeHash: 'h2' })]))

    assert.equal(diff.billable, 3)
    assert.isNotEmpty(diff.warnings)
    assert.match(diff.warnings[0], /Effort Complexity/)
  })

  test('sem alteração não há aviso de fator', async ({ assert }) => {
    const diff = diffCounts(result([fn()]), result([fn()]))
    assert.isEmpty(diff.warnings)
  })
})

test.group('diff: ruleset', () => {
  /**
   * Se as regras mudaram entre as duas medições, a diferença não mede trabalho —
   * mede a mudança de regra. E o resultado ia para uma fatura.
   */
  test('recusa comparar versões de ruleset diferentes', async ({ assert }) => {
    assert.throws(
      () => diffCounts(result([fn()], '1.0.0'), result([fn()], '2.0.0')),
      IncomparableRulesetsError
    )
  })

  test('a mensagem explica por que a comparação é inválida', async ({ assert }) => {
    try {
      diffCounts(result([fn()], '1.0.0'), result([fn()], '1.1.0'))
      assert.fail('deveria ter lançado')
    } catch (error) {
      assert.match((error as Error).message, /measures the rule change/)
    }
  })

  test('mesma versão compara normalmente', async ({ assert }) => {
    const diff = diffCounts(result([fn()], '1.0.0'), result([fn()], '1.0.0'))
    assert.lengthOf(diff.entries, 1)
  })
})
