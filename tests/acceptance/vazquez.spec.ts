import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectDataStores } from '../../src/inventory/sources/data_stores.js'
import { collectEntryPoints } from '../../src/inventory/sources/routes_ast.js'
import { createAnalyzer } from '../../src/inventory/graph/call_graph.js'
import { count } from '../../src/albrecht/counter.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * BENCHMARK EXTERNO — Vazquez, Simões e Albert (2011)
 *
 * O único gabarito deste projeto que não foi produzido por nós: uma contagem
 * manual publicada, sobre uma especificação que não escrevemos.
 *
 * A fixture e o gabarito (`fixtures/apps/vazquez/REFERENCIA.md`) foram
 * congelados em commit próprio ANTES de o contador ser rodado sobre eles, e as
 * escolhas de transcrição estão documentadas lá. Sem isso a independência seria
 * ilusória: nada impediria ajustar a fixture até bater o número.
 *
 * Referências: gabarito 46 PF · Ligeiro automático 52 (+13%) · manual pelas
 * regras do Ligeiro 43 (−6,5%).
 */

/** gabarito, função por função — Tabela 6.7, coluna VAZQUEZ et al. (2011) */
const GABARITO = {
  total: 46,
  dados: {
    Pessoa: { tipo: 'EIF', det: 4, refs: 1, pf: 5 },
    Justificativa: { tipo: 'ILF', det: 3, refs: 1, pf: 7 },
    Apontamento: { tipo: 'ILF', det: 4, refs: 1, pf: 7 },
  },
  transacoes: {
    'GET /apontamentos': { rotulo: 'Consulta Apontamento Diário', pf: 3 },
    'POST /apontamentos': { rotulo: 'Registro de Ponto', pf: 3 },
    'PUT /apontamentos/:param': { rotulo: 'Alteração de Apontamento', pf: 4 },
    'DELETE /apontamentos/:param': { rotulo: 'Exclusão de Apontamento', pf: 3 },
    'POST /apontamentos/justificar': { rotulo: 'Apontamento c/ Justificativa', pf: 4 },
    'GET /presenca': { rotulo: 'Acompanhar Presença', pf: 5 },
    'GET /presenca/relatorio': { rotulo: 'Emitir Relatório de Presença', pf: 5 },
  },
} as const

async function contar(): Promise<CountResult> {
  const app = await discoverApp(appFixturePath('vazquez'))
  const { stores } = await collectDataStores(app)
  const { entryPoints } = await collectEntryPoints(app)
  const analyzer = createAnalyzer(app, stores)

  const behaviors = new Map(
    entryPoints
      .filter((entry) => entry.handler)
      .map((entry) => [entry.id, analyzer.analyze(entry.handler!)])
  )

  // `Pessoa` é parte do controle de acesso, fora da fronteira — ver REFERENCIA.md
  return count({ app, stores, entryPoints, behaviors }, { externallyMaintained: ['Pessoa'] })
}

const pf = (result: CountResult, name: string) => result.functions.find((f) => f.name === name)

test.group('benchmark Vazquez: funções de dados', () => {
  /**
   * As funções de dados são a metade previsível da contagem: saem das colunas,
   * quase sem heurística. Exatidão aqui é o mínimo exigível.
   */
  test('as três funções de dados batem exatamente com o gabarito', async ({ assert }) => {
    const result = await contar()

    for (const [nome, esperado] of Object.entries(GABARITO.dados)) {
      const contado = pf(result, nome)
      assert.exists(contado, `${nome} não foi contada`)
      assert.equal(contado!.type, esperado.tipo, `${nome}: tipo`)
      assert.equal(contado!.det, esperado.det, `${nome}: DET`)
      assert.equal(contado!.refs, esperado.refs, `${nome}: RET`)
      assert.equal(contado!.points, esperado.pf, `${nome}: PF`)
    }
  })
})

test.group('benchmark Vazquez: funções transacionais', () => {
  test('as sete transações do estudo de caso são identificadas', async ({ assert }) => {
    const result = await contar()

    for (const [identidade, esperado] of Object.entries(GABARITO.transacoes)) {
      assert.exists(pf(result, identidade), `${esperado.rotulo} (${identidade}) não foi contada`)
    }
  })

  /**
   * As duas divergências foram PREVISTAS em REFERENCIA.md antes de rodar, e são
   * da norma, não defeitos:
   *
   *   +1  `Consulta Apontamento Diário` é CE no gabarito. O AFP §6.5.3 manda
   *       colapsar CE em SE, porque intenção primária não é detectável — e SE
   *       pesa mais que CE na mesma faixa.
   *   −1  `Apontamento c/ Justificativa`: o manual do IFPUG conta 1 DET de
   *       mensagem ao usuário, o AFP não. É a divergência sistemática que o
   *       Ligeiro também mediu.
   */
  test('as divergências são exatamente as duas previstas', async ({ assert }) => {
    const result = await contar()

    const divergentes = Object.entries(GABARITO.transacoes)
      .map(([identidade, esperado]) => ({
        identidade,
        esperado: esperado.pf,
        obtido: pf(result, identidade)?.points ?? 0,
      }))
      .filter((item) => item.obtido !== item.esperado)

    assert.deepEqual(
      divergentes.map((d) => `${d.identidade} ${d.esperado}->${d.obtido}`).sort(),
      ['GET /apontamentos 3->4', 'POST /apontamentos/justificar 4->3'],
      'apareceu divergência não prevista, ou uma prevista desapareceu'
    )
  })

  test('cinco das sete transações batem exatamente', async ({ assert }) => {
    const result = await contar()

    const exatas = Object.entries(GABARITO.transacoes).filter(
      ([identidade, esperado]) => pf(result, identidade)?.points === esperado.pf
    )

    assert.lengthOf(exatas, 5)
  })
})

test.group('benchmark Vazquez: total', () => {
  /**
   * O total bate exatamente — mas em parte por CANCELAMENTO: as duas
   * divergências previstas são +1 e −1.
   *
   * Registrar isso importa. O spike já havia observado que o total é mais
   * estável que a classificação individual, e aqui está a confirmação contra um
   * gabarito externo: 8 de 10 funções exatas, e as duas que erram se anulam.
   * Quem for defender a contagem função por função precisa saber disso.
   */
  test('o total bate com o gabarito, com as divergências se cancelando', async ({ assert }) => {
    const result = await contar()

    assert.equal(result.totals.unadjusted, GABARITO.total)

    const exatas = result.functions.filter((f) => {
      const dado = GABARITO.dados[f.name as keyof typeof GABARITO.dados]
      const tx = GABARITO.transacoes[f.name as keyof typeof GABARITO.transacoes]
      return dado ? f.points === dado.pf : tx ? f.points === tx.pf : false
    })

    assert.lengthOf(exatas, 8, '8 das 10 funções batem exatamente')
  })

  /** Tolerância declarada: o Ligeiro ficou em +13%; exigimos bem menos. */
  test('o desvio fica dentro da tolerância declarada de 5%', async ({ assert }) => {
    const result = await contar()
    const desvio = Math.abs(result.totals.unadjusted - GABARITO.total) / GABARITO.total

    assert.isBelow(desvio, 0.05)
  })

  /** Um total bom com rastreamento ruim não valeria nada. */
  test('a contagem não depende de pendência nem de rota sem handler', async ({ assert }) => {
    const result = await contar()

    assert.equal(result.confidence.unresolvedCalls, 0)
    assert.equal(result.confidence.entryPointsWithoutHandler, 0)
  })
})
