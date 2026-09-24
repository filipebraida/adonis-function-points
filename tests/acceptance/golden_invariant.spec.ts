import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectDataStores } from '../../src/inventory/sources/data_stores.js'
import { collectEntryPoints } from '../../src/inventory/sources/routes_ast.js'
import { createAnalyzer } from '../../src/inventory/graph/call_graph.js'
import { count } from '../../src/albrecht/counter.js'
import { appFixturePath } from '../helpers.js'

/**
 * A INVARIANTE DE OURO
 *
 * A mesma aplicação lógica, escrita de formas diferentes, tem que produzir
 * contagem idêntica.
 *
 * Três fixtures com as mesmas duas entidades, as mesmas três transações e a
 * mesma lógica, divergindo em tudo que NÃO deveria importar:
 *
 *                   minimal_flat        minimal_modular      minimal_nogen
 *   layout          app/models/         app/catalog/…        app/admin/catalog/…
 *   aliases         #models/*           #catalog/*           #admin/* + #catalog/*
 *   colunas         schema gerado       schema gerado        @column no model
 *   rotas           start/routes.ts     app/catalog/routes   hub → start/routes/
 *   controller      mapa gerado         mapa gerado          lazy import
 *   escrita         app/actions/        app/catalog/actions  src/catalog/actions
 *   gerados         sim                 sim                  NENHUM
 *
 * As duas primeiras foram escritas pela mesma mão e compartilham registry e
 * schema byte a byte: são regressão. Quem testa generalização é a terceira,
 * que força o caminho por AST.
 *
 * Se qualquer coisa no pacote passar a depender de convenção de pasta, de
 * alias ou de estilo de escrita, este teste falha. É o teste mais importante
 * do projeto, e por isso foi escrito antes do primeiro coletor.
 *
 * As asserções são destravadas fase por fase — ver
 * docs/design/implementation-plan.md.
 */
const APPS = ['minimal_flat', 'minimal_modular', 'minimal_nogen'] as const

test.group('invariante de ouro: a forma não muda a contagem', () => {
  test('Fase 1 — as três apps são descobertas de forma equivalente', async ({ assert }) => {
    const apps = await Promise.all(APPS.map((name) => discoverApp(appFixturePath(name))))
    const [flat, modular, nogen] = apps

    for (const app of apps) {
      // cada uma resolve os próprios aliases, que são diferentes entre si
      assert.isTrue(app.subpathImports.size > 0)

      // todas estão no escopo do v1
      assert.isTrue(app.framework.supported)

      // todas expõem rota, raiz de varredura e o mesmo model alcançável
      assert.isNotEmpty(app.routeFiles, 'nenhum arquivo de rota')
      assert.isNotEmpty(app.scanRoots, 'nenhuma raiz de varredura')
    }

    // o model equivalente é alcançável nas três, por aliases distintos
    assert.isNotNull(flat.resolveSpecifier('#models/book'))
    assert.isNotNull(modular.resolveSpecifier('#catalog/models/book'))
    assert.isNotNull(nogen.resolveSpecifier('#admin/catalog/models/book'))

    // as diferenças ficam confinadas a layout e artefatos gerados
    assert.equal(flat.layout, 'flat')
    assert.equal(modular.layout, 'module-per-domain')

    for (const app of [flat, modular]) {
      assert.isDefined(app.generated.dataSchema, 'schema de dados não encontrado')
      assert.isDefined(app.generated.routeRegistry, 'registry não encontrado')
    }

    // a terceira não tem gerado nenhum — é o ponto dela
    assert.isUndefined(nogen.generated.dataSchema)
    assert.isUndefined(nogen.generated.routeRegistry)
    assert.isUndefined(nogen.generated.controllersMap)
  })

  test('Fase 2 — as três apps produzem os mesmos repositórios de dados', async ({ assert }) => {
    const resultados = await Promise.all(
      APPS.map(async (name) => collectDataStores(await discoverApp(appFixturePath(name))))
    )

    /**
     * Assinatura comparável: nome, tabela e colunas. Deliberadamente NÃO inclui
     * `module` nem `provenance` — são justamente o que muda entre layouts, e
     * incluí-los faria o teste afirmar o contrário do que existe para afirmar.
     */
    const assinatura = (result: (typeof resultados)[number]) =>
      result.stores
        .map(
          (store) =>
            `${store.name}:${store.table}:${store.attributes
              .map((a) => a.name)
              .sort()
              .join(',')}`
        )
        .sort()
        .join(' | ')

    const [referencia, ...outras] = resultados.map(assinatura)

    for (const [index, assinaturaOutra] of outras.entries()) {
      assert.equal(assinaturaOutra, referencia, `${APPS[index + 1]} divergiu de ${APPS[0]}`)
    }

    // e a assinatura descreve a app que as três implementam
    assert.include(referencia, 'Author:authors')
    assert.include(referencia, 'Book:books')
    assert.include(referencia, 'authorId,createdAt,id,isbn,publishedYear,title')
  })

  test('Fase 3 — as três apps produzem os mesmos pontos de entrada', async ({ assert }) => {
    const resultados = await Promise.all(
      APPS.map(async (name) => collectEntryPoints(await discoverApp(appFixturePath(name))))
    )

    /**
     * Compara por IDENTIDADE — verbo mais padrão normalizado. É o que
     * counting-decisions §5 define como estável entre versões, e é justamente
     * o que não pode depender de como a rota foi escrita.
     */
    const assinatura = (result: (typeof resultados)[number]) =>
      result.entryPoints
        .map((entry) => entry.identity)
        .sort()
        .join(' | ')

    const [referencia, ...outras] = resultados.map(assinatura)

    for (const [index, outra] of outras.entries()) {
      assert.equal(outra, referencia, `${APPS[index + 1]} divergiu de ${APPS[0]}`)
    }

    assert.equal(referencia, 'DELETE /books/:param | GET /books | POST /books')

    // e as três resolvem o handler das três transações
    for (const result of resultados) {
      assert.isEmpty(result.unresolved)
      for (const entry of result.entryPoints) assert.isNotNull(entry.handler)
    }
  })

  test('Fase 5 — as três apps produzem contagem idêntica', async ({ assert }) => {
    const resultados = await Promise.all(
      APPS.map(async (name) => {
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
      })
    )

    /**
     * Assinatura de contagem: tipo, DET, FTR e pontos por função.
     *
     * Deliberadamente NÃO inclui `module` nem `rationale` — são o que muda
     * entre layouts, e incluí-los faria o teste afirmar o contrário do que
     * existe para afirmar.
     */
    const assinatura = (result: (typeof resultados)[number]) =>
      result.functions
        .map((fn) => `${fn.name}:${fn.type}:${fn.det}/${fn.refs}=${fn.points}`)
        .sort()
        .join(' | ')

    const [referencia, ...outras] = resultados.map(assinatura)

    for (const [index, outra] of outras.entries()) {
      assert.equal(outra, referencia, `${APPS[index + 1]} divergiu de ${APPS[0]}`)
    }

    // e o total é o mesmo nas três
    const totais = resultados.map((result) => result.totals.unadjusted)
    assert.deepEqual(totais, [totais[0], totais[0], totais[0]])
    assert.isAbove(totais[0], 0)
  })
})
