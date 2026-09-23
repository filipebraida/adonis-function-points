import { test } from '@japa/runner'
import path from 'node:path'

import { discoverApp } from '../../src/inventory/app_context.js'
import { appFixturePath } from '../helpers.js'

test.group('AppContext: aliases de subpath', () => {
  /**
   * Existem duas convenções incompatíveis em uso nas apps levantadas — por
   * tipo (`#models/*`) e por módulo (`#catalog/*`). Deduzir pelo formato
   * funciona numa família e falha na outra; tem que LER o package.json.
   */
  test('lê o mapa do package.json em vez de deduzir', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    assert.isTrue(flat.subpathImports.has('#models/*'))
    assert.isFalse(flat.subpathImports.has('#catalog/*'))

    assert.isTrue(modular.subpathImports.has('#catalog/*'))
    assert.isFalse(modular.subpathImports.has('#models/*'))
  })

  test('resolve o mesmo model por aliases diferentes', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    assert.equal(
      path.basename(flat.resolveSpecifier('#models/book')!),
      path.basename(modular.resolveSpecifier('#catalog/models/book')!)
    )
  })

  test('traduz o alvo .js do mapa para o .ts que analisamos', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.match(app.resolveSpecifier('#models/book')!, /app\/models\/book\.ts$/)
  })

  /**
   * `#app/*` e `#app/legacy/*` casam os dois com `#app/legacy/importer`, e
   * apontam para lugares DIFERENTES. O mais específico tem que vencer — é o
   * que o spec de subpath imports do Node manda — senão a resolução aponta
   * para o arquivo errado em silêncio.
   *
   * Nenhuma das aplicações levantadas tem sobreposição assim hoje; a fixture
   * existe porque a regra está no código e código não exercitado apodrece.
   */
  test('alias mais específico vence o mais genérico', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('overlapping_aliases'))
    const resolved = app.resolveSpecifier('#app/legacy/importer')!

    assert.match(resolved, /vendor\/legacy\/importer\.ts$/)
    assert.notMatch(resolved, /app\/legacy\/importer\.ts$/)
  })

  test('alias sem sobreposição resolve direto', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('overlapping_aliases'))
    assert.match(app.resolveSpecifier('#core/database/schema')!, /app\/core\/database\/schema\.ts$/)
  })

  test('resolve alias sem curinga', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('overlapping_aliases'))
    assert.match(app.resolveSpecifier('#exact')!, /billing\/models\/invoice\.ts$/)
  })

  test('devolve null para specifier de pacote, não chuta', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.isNull(app.resolveSpecifier('@adonisjs/core/http'))
    assert.isNull(app.resolveSpecifier('luxon'))
    assert.isNull(app.resolveSpecifier('#desconhecido/coisa'))
  })
})

test.group('AppContext: artefatos gerados', () => {
  test('acha o schema pelo que ele é, não por onde está', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    assert.match(flat.generated.dataSchema!, /(^|\/)database\/schema\.ts$/)
    assert.match(modular.generated.dataSchema!, /app\/core\/database\/schema\.ts$/)
  })

  test('acha schema gerado em caminho não convencional', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('overlapping_aliases'))
    assert.isDefined(app.generated.dataSchema)
  })

  /**
   * Ausência é fato reportável, não algo a contornar em silêncio: sem registry
   * a contagem cai para o parser de rotas, que erra mais. O relatório tem que
   * poder dizer isso — o AFP exige que o que faltou apareça.
   */
  test('reporta ausência em vez de assumir', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('no_generated'))

    assert.isUndefined(app.generated.routeRegistry)
    assert.isUndefined(app.generated.controllersMap)
    assert.isUndefined(app.generated.dataSchema)
  })

  test('não confunde schema escrito à mão com schema gerado', async ({ assert }) => {
    // no_generated tem models com @column, mas nenhum arquivo gerado
    const app = await discoverApp(appFixturePath('no_generated'))
    assert.isUndefined(app.generated.dataSchema)
  })
})

test.group('AppContext: layout', () => {
  test('distingue as duas famílias', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    assert.equal(flat.layout, 'flat')
    assert.equal(modular.layout, 'module-per-domain')
  })

  test('agrupa por módulo no modular e sem módulo no plano', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    assert.equal(modular.moduleOf(modular.resolveSpecifier('#catalog/models/book')!), 'catalog')
    assert.equal(flat.moduleOf(flat.resolveSpecifier('#models/book')!), 'app')
  })

  test('layout é o único campo em que as duas apps divergem', async ({ assert }) => {
    const flat = await discoverApp(appFixturePath('minimal_flat'))
    const modular = await discoverApp(appFixturePath('minimal_modular'))

    // os três gerados presentes dos dois lados
    const presence = (a: typeof flat) => Object.values(a.generated).filter(Boolean).length
    assert.equal(presence(flat), presence(modular))
    assert.notEqual(flat.layout, modular.layout)
  })
})
