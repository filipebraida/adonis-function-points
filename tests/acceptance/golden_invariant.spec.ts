import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
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

  test('Fase 2 — as três apps produzem os mesmos repositórios de dados', ({ assert }) => {
    assert.isTrue(true)
  }).skip(true, 'aguarda sources/data_schema')

  test('Fase 3 — as três apps produzem os mesmos pontos de entrada', ({ assert }) => {
    assert.isTrue(true)
  }).skip(true, 'aguarda sources/route_registry')

  test('Fase 5 — as três apps produzem contagem idêntica', ({ assert }) => {
    assert.isTrue(true)
  }).skip(true, 'aguarda albrecht/counter')
})
