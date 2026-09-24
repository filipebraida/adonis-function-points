import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectDataStores } from '../../src/inventory/sources/data_stores.js'
import { collectEntryPoints } from '../../src/inventory/sources/routes_ast.js'
import { createAnalyzer } from '../../src/inventory/graph/call_graph.js'
import { count } from '../../src/albrecht/counter.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

async function countApp(name: string): Promise<CountResult> {
  const app = await discoverApp(appFixturePath(name))
  const { stores } = await collectDataStores(app)
  const { entryPoints } = await collectEntryPoints(app)
  const analyzer = createAnalyzer(app, stores)

  const behaviors = new Map(
    entryPoints
      .filter((entry) => entry.handler)
      .map((entry) => [entry.id, analyzer.analyze(entry.handler!)])
  )

  return count({ app, stores, entryPoints, behaviors })
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found)
    throw new Error(
      `função "${name}" não contada; existem: ${result.functions.map((f) => f.name).join(', ')}`
    )
  return found
}

/**
 * A app das fixtures é pequena o bastante para ter a contagem conferida à mão,
 * que é a única forma de saber que o motor está certo:
 *
 *   Author  3 DET (name, country, createdAt) · lido por relação, nunca escrito
 *   Book    5 DET (authorId, title, isbn, publishedYear, createdAt) · escrito
 *
 *   GET    /books      lê Book e Author            -> SE
 *   POST   /books      escreve Book                 -> EE
 *   DELETE /books/:id  escreve Book                 -> EE
 */
test.group('contagem: funções de dados', () => {
  /**
   * AFP §6.5.4: se alguma transação da aplicação escreve, é ALI. Se só lê, AIE.
   */
  test('escrito pela aplicação é ALI; só lido é AIE', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(fn(result, 'Book').type, 'ILF')
    assert.equal(fn(result, 'Author').type, 'EIF')
  })

  test('DET exclui o identificador técnico', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(fn(result, 'Author').det, 3)
    assert.equal(fn(result, 'Book').det, 5)
  })

  test('RET começa em 1, conforme a estratégia padrão', async ({ assert }) => {
    const result = await countApp('minimal_flat')
    assert.equal(fn(result, 'Book').refs, 1)
  })

  test('ALI de baixa complexidade vale 7; AIE vale 5', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(fn(result, 'Book').complexity, 'low')
    assert.equal(fn(result, 'Book').points, 7)
    assert.equal(fn(result, 'Author').points, 5)
  })
})

test.group('contagem: funções transacionais', () => {
  /** AFP §6.5.3: transação que modifica dado é EE; as outras são SE. */
  test('quem escreve é EE, quem só lê é SE', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(fn(result, 'POST /books').type, 'EI')
    assert.equal(fn(result, 'DELETE /books/:param').type, 'EI')
    assert.equal(fn(result, 'GET /books').type, 'EO')
  })

  /** O AFP colapsa CE em SE: intenção primária não é detectável. */
  test('nenhuma função é classificada como CE', async ({ assert }) => {
    const result = await countApp('minimal_flat')
    assert.notInclude(
      result.functions.map((f) => f.type),
      'EQ'
    )
  })

  test('FTR conta os repositórios alcançados', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    // a listagem alcança Book e, por preload, Author
    assert.equal(fn(result, 'GET /books').refs, 2)
    assert.equal(fn(result, 'POST /books').refs, 1)
  })

  /** counting-decisions §1: sem acesso a dado, não é função transacional. */
  test('transação que não alcança dado não é contada', async ({ assert }) => {
    const result = await countApp('edges_boundary')

    assert.exists(result.functions.find((f) => f.name === 'GET /notes'))
    assert.notExists(
      result.functions.find((f) => f.name === 'GET /about'),
      'rota que não alcança dado não é função transacional'
    )
  })
})

/**
 * As bordas decididas em counting-decisions, cada uma com uma tabela na fixture
 * que a exercita. Sem elas, as guardas do contador passam mutação: em
 * `minimal_flat` toda tabela é alcançada e toda rota alcança dado.
 */
test.group('contagem: bordas', () => {
  /** AFP §6.5.4: repositório que nenhuma transação alcança não entra. */
  test('repositório órfão não é contado', async ({ assert }) => {
    const result = await countApp('edges_boundary')

    assert.exists(result.functions.find((f) => f.name === 'Note'))
    assert.notExists(
      result.functions.find((f) => f.name === 'OrphanLog'),
      'tabela que ninguém alcança não é função de dados'
    )
  })

  /**
   * AFP §6.5.2.1.1: tabela técnica sai da contagem — e o relatório tem que
   * dizer POR QUE, não só omitir.
   */
  test('tabela técnica sai da contagem e aparece no relatório', async ({ assert }) => {
    const result = await countApp('edges_boundary')

    assert.notExists(
      result.functions.find((f) => f.name === 'UserSession'),
      'tabela de sessão é dado temporário pelo spec'
    )
    assert.isTrue(
      result.confidence.warnings.some((w) => w.includes('UserSession')),
      'a exclusão precisa aparecer no relatório'
    )
  })

  /**
   * A transação que só toca tabela técnica perde o FTR e, por §1, deixa de ser
   * função transacional — a exclusão da tabela propaga.
   */
  test('transação que só toca tabela técnica não é contada', async ({ assert }) => {
    const result = await countApp('edges_boundary')
    assert.notExists(result.functions.find((f) => f.name === 'POST /sessions/touch'))
  })
})

test.group('contagem: total e procedência', () => {
  test('o total é a soma das funções', async ({ assert }) => {
    const result = await countApp('minimal_flat')
    const soma = result.functions.reduce((total, f) => total + f.points, 0)

    assert.equal(result.totals.unadjusted, soma)
    assert.isAbove(result.totals.unadjusted, 0)
  })

  test('os totais por tipo fecham com o total geral', async ({ assert }) => {
    const result = await countApp('minimal_flat')
    const porTipo = Object.values(result.totals.byType).reduce((t, v) => t + v.points, 0)

    assert.equal(porTipo, result.totals.unadjusted)
  })

  /**
   * A procedência é requisito, não enfeite: se PF vira fatura, alguém vai
   * contestar um número, e um número sem origem é indefensável.
   */
  test('toda função contada diz a regra que a classificou', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    for (const counted of result.functions) {
      assert.isNotEmpty(counted.rationale.rule, `${counted.name} sem regra`)
      assert.match(counted.rationale.rule, /afp:/, 'a regra deve citar a norma')
    }
  })

  test('DET e FTR dizem de onde vieram', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.isNotEmpty(fn(result, 'Book').rationale.detSources)
    assert.isNotEmpty(fn(result, 'GET /books').rationale.refSources)
  })

  /** O ruleset versionado é o que torna duas contagens comparáveis. */
  test('o resultado declara o ruleset e a versão', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.equal(result.ruleset, 'afp')
    assert.match(result.rulesetVersion, /^\d+\.\d+\.\d+$/)
  })

  test('a confiança reporta pendências e rotas sem handler', async ({ assert }) => {
    const result = await countApp('minimal_flat')

    assert.isNumber(result.confidence.unresolvedCalls)
    assert.isNumber(result.confidence.entryPointsWithoutHandler)
  })
})
