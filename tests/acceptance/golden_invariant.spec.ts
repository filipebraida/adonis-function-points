import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { appFixturePath } from '../helpers.js'

/**
 * A INVARIANTE DE OURO
 *
 * A mesma aplicação lógica, escrita em dois layouts diferentes, tem que
 * produzir contagem idêntica.
 *
 * `minimal_flat` e `minimal_modular` têm as mesmas duas entidades, as mesmas
 * três transações e a mesma lógica. Diferem em tudo que NÃO deveria importar:
 *
 *   layout          app/models/          vs  app/catalog/models/
 *   aliases         #models/*            vs  #catalog/*
 *   schema gerado   database/schema.ts   vs  app/core/database/schema.ts
 *   rotas           start/routes.ts      vs  app/catalog/routes.ts
 *   mapa gerado     controllers.Books    vs  controllers.catalog.Books
 *   estilo de rota  uma linha            vs  multi-linha encadeada
 *
 * Se qualquer coisa no pacote passar a depender de convenção de pasta, de
 * alias ou de estilo de escrita, este teste falha. É o teste mais importante
 * do projeto, e por isso foi escrito antes do primeiro coletor.
 *
 * As asserções são destravadas fase por fase — ver
 * docs/design/implementation-plan.md.
 */
test.group('invariante de ouro: layout não muda a contagem', () => {
  test('Fase 1 — as duas apps são descobertas de forma equivalente', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    // ambas resolvem seus próprios aliases, que são diferentes
    assert.isTrue(flat.subpathImports.size > 0)
    assert.isTrue(modular.subpathImports.size > 0)

    // ambas acham os três artefatos gerados, em caminhos diferentes
    for (const app of [flat, modular]) {
      assert.isDefined(app.generated.routeRegistry, 'registry de rotas não encontrado')
      assert.isDefined(app.generated.controllersMap, 'mapa de controllers não encontrado')
      assert.isDefined(app.generated.dataSchema, 'schema de dados não encontrado')
    }

    // o layout é a ÚNICA diferença que o contexto deve expor
    assert.equal(flat.layout, 'flat')
    assert.equal(modular.layout, 'module-per-domain')

    // e o model equivalente é alcançável em ambas, por aliases distintos
    assert.isNotNull(flat.resolveSpecifier('#models/book'))
    assert.isNotNull(modular.resolveSpecifier('#catalog/models/book'))
  })

  test('Fase 2 — as duas apps produzem os mesmos repositórios de dados', ({ assert }) => {
    assert.isTrue(true)
  }).skip(true, 'aguarda sources/data_schema')

  test('Fase 3 — as duas apps produzem os mesmos pontos de entrada', ({ assert }) => {
    assert.isTrue(true)
  }).skip(true, 'aguarda sources/route_registry')

  test('Fase 5 — as duas apps produzem contagem idêntica', ({ assert }) => {
    assert.isTrue(true)
  }).skip(true, 'aguarda albrecht/counter')
})
