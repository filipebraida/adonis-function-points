import { test } from '@japa/runner'
import { Node, SyntaxKind } from 'ts-morph'

import { analyze } from '../../src/pipeline.js'
import { defineConfig } from '../../src/define_config.js'
import type { CallResolver } from '../../src/inventory/resolvers/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * Configuração que o código não honra é pior que configuração ausente: quem a
 * define acha que mudou algo, e não mudou.
 *
 * Cada opção exposta em `defineConfig` tem um teste aqui provando que tem
 * efeito. Se uma opção não puder ser honrada, ela sai do tipo — não fica como
 * promessa.
 */

test.group('config: fronteira da aplicação', () => {
  /**
   * A fronteira é decisão de negócio, não heurística — é por isso que é
   * configuração e não regra embutida.
   */
  test('`infrastructure` tira o repositório da contagem', async ({ assert }) => {
    const semConfig = await analyze(appFixturePath('minimal_flat'))
    assert.exists(semConfig.count.functions.find((fn) => fn.name === 'Book'))

    const comConfig = await analyze(appFixturePath('minimal_flat'), {
      boundary: { infrastructure: ['Book'] },
    })

    assert.notExists(comConfig.count.functions.find((fn) => fn.name === 'Book'))
    assert.isTrue(
      comConfig.count.confidence.warnings.some((w) => w.includes('Book')),
      'exclusão por configuração também precisa aparecer no relatório'
    )
  })

  test('`externallyMaintained` transforma ALI em AIE', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'), {
      boundary: { externallyMaintained: ['Book'] },
    })

    assert.equal(count.functions.find((fn) => fn.name === 'Book')!.type, 'EIF')
  })

  test('`ignoreEntryPoints` tira a rota da contagem', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'), {
      boundary: { ignoreEntryPoints: ['books.index'] },
    })

    assert.notExists(count.functions.find((fn) => fn.name === 'GET /books'))
    assert.exists(count.functions.find((fn) => fn.name === 'POST /books'))
  })

  test('o nome pode ser a identidade ou o nome da rota', async ({ assert }) => {
    const porIdentidade = await analyze(appFixturePath('minimal_flat'), {
      boundary: { ignoreEntryPoints: ['GET /books'] },
    })

    assert.notExists(porIdentidade.count.functions.find((fn) => fn.name === 'GET /books'))
  })
})

test.group('config: tabelas de complexidade', () => {
  /**
   * As tabelas são configuráveis porque o estudo do Ligeiro mostrou que 1 DET
   * de diferença — a mensagem que nenhuma análise estática vê — cruza a faixa e
   * muda o valor. Calibrar as faixas é mais honesto que fingir que o viés não
   * existe.
   */
  test('`weights` muda o valor das funções', async ({ assert }) => {
    const padrao = await analyze(appFixturePath('minimal_flat'))
    const alterado = await analyze(appFixturePath('minimal_flat'), {
      weights: { ILF: { low: 70, average: 100, high: 150 } },
    })

    assert.isAbove(alterado.count.totals.unadjusted, padrao.count.totals.unadjusted)
  })

  test('`complexityTables` muda as faixas', async ({ assert }) => {
    const padrao = await analyze(appFixturePath('minimal_flat'))
    const apertado = await analyze(appFixturePath('minimal_flat'), {
      // faixa de DET estreita: 5 colunas passam a cair na faixa mais alta
      complexityTables: { ILF: { refBands: [1, 5], detBands: [1, 2] } },
    })

    assert.equal(padrao.count.functions.find((fn) => fn.name === 'Book')!.complexity, 'low')

    /**
     * Com RET = 1 a grade do IFPUG não chega a "alta": a primeira faixa de
     * RET vai até média. Subir a complexidade exige RET maior, não só DET.
     */
    assert.equal(apertado.count.functions.find((fn) => fn.name === 'Book')!.complexity, 'average')
    assert.isAbove(apertado.count.totals.unadjusted, padrao.count.totals.unadjusted)
  })

  test('`messageDet` acrescenta o DET que o IFPUG conta e o AFP não', async ({ assert }) => {
    const afp = await analyze(appFixturePath('minimal_flat'))
    const ifpug = await analyze(appFixturePath('minimal_flat'), { messageDet: 1 })

    const antes = afp.count.functions.find((fn) => fn.name === 'POST /books')!
    const depois = ifpug.count.functions.find((fn) => fn.name === 'POST /books')!

    assert.equal(depois.det, antes.det + 1)
  })
})

test.group('config: resolvedor próprio', () => {
  /**
   * A afirmação central da arquitetura: AdonisJS não impõe padrão de
   * organização, então o rastreamento é extensível. Se o resolvedor registrado
   * na configuração não entrar no grafo, a afirmação é falsa.
   *
   * Este resolvedor reconhece um padrão que nenhum embutido cobre:
   * `repo<Model>().gravar()`.
   */
  const repositorioFicticio: CallResolver = {
    name: 'repo-ficticio',
    order: 1,
    resolve(call, ctx) {
      const expression = call.getExpression()
      if (!Node.isPropertyAccessExpression(expression)) return []
      if (expression.getName() !== 'gravar') return []

      const receiver = expression.getExpression()
      if (!Node.isCallExpression(receiver)) return []
      if (receiver.getExpression().getText() !== 'repo') return []

      const alvo = receiver.getArguments()[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
      const arquivo = alvo ? ctx.resolveSpecifier(alvo) : null
      return arquivo ? [{ file: arquivo, member: 'gravar' }] : []
    },
  }

  test('resolvedor da configuração entra no grafo', async ({ assert }) => {
    const semEle = await analyze(appFixturePath('custom_resolver'))
    const comEle = await analyze(appFixturePath('custom_resolver'), {
      resolvers: { call: [repositorioFicticio] },
    })

    const rota = 'POST /itens'
    assert.notExists(
      semEle.count.functions.find((fn) => fn.name === rota),
      'sem o resolvedor a transação não alcança dado e não conta'
    )
    assert.exists(
      comEle.count.functions.find((fn) => fn.name === rota),
      'com o resolvedor a transação alcança o dado'
    )
    assert.equal(comEle.count.functions.find((fn) => fn.name === rota)!.type, 'EI')
  })

  test('resolvedor da configuração roda antes dos embutidos', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('custom_resolver'), {
      resolvers: { call: [repositorioFicticio] },
    })

    const trilha = count.functions.find((fn) => fn.name === 'POST /itens')!.rationale.trace!
    assert.isTrue(
      trilha.some((passo) => passo.by === 'repo-ficticio'),
      'o rastro tem que dizer que foi a estratégia do usuário'
    )
  })
})

test.group('config: defineConfig', () => {
  test('preenche os defaults sem apagar o que foi passado', async ({ assert }) => {
    const config = defineConfig({ boundary: { infrastructure: ['audits'] } })

    assert.deepEqual(config.boundary.infrastructure, ['audits'])
    assert.equal(config.retStrategy, 'constant')
    assert.equal(config.messageDet, 0, 'default segue o AFP, não o manual do IFPUG')
  })

  test('não expõe opção que o código não honra', async ({ assert }) => {
    const config = defineConfig({}) as Record<string, unknown>

    // removidas por não terem efeito: ver docs/design/architecture.md
    assert.notProperty(config, 'collapseInquiriesIntoOutputs')
    assert.notProperty(config, 'calibration')
  })
})
