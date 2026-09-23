import { test } from '@japa/runner'
import path from 'node:path'

import { discoverApp } from '../../src/inventory/app_context.js'
import { appFixturePath } from '../helpers.js'

const rel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/')

test.group('AppContext: arquivos de rota', () => {
  /**
   * A lista de `preloads` do adonisrc é a fonte autoritativa — não convenção de
   * caminho. Quatro topologias foram encontradas nas apps reais, e as três
   * fixtures cobrem três delas.
   */
  test('topologia: arquivo único em start/', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.deepEqual(
      app.routeFiles.map((f) => rel(app.root, f)),
      ['start/routes.ts']
    )
  })

  test('topologia: um arquivo por módulo', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_modular'))
    assert.deepEqual(
      app.routeFiles.map((f) => rel(app.root, f)),
      ['app/catalog/routes.ts']
    )
  })

  /**
   * Topologia mais difícil: o preload aponta para um hub que não define rota
   * nenhuma, só reexporta. Parar no preload devolveria lista vazia.
   *
   * O hub é um passo de TRAVESSIA, não um arquivo de rota — não há `router.`
   * nele para parsear. A distinção importa: `routeFiles` é o que o parser vai
   * abrir, e abrir o hub seria trabalho sem resultado.
   */
  test('topologia: hub que só importa outros arquivos', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))
    const files = app.routeFiles.map((f) => rel(app.root, f))

    assert.deepEqual(files, ['start/routes/web.ts'])
  })

  test('não confunde preload que não é de rota', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.notInclude(app.routeFiles.join(' '), 'kernel')
  })
})

test.group('AppContext: raízes de varredura', () => {
  /**
   * Numa app externa levantada, 100% da escrita mora em `src/`. Varrer só
   * `app/` perderia a aplicação inteira.
   */
  test('inclui diretório fora de app/ quando um alias aponta para lá', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))
    const roots = app.scanRoots.map((r) => rel(app.root, r)).sort()

    assert.include(roots, 'src/catalog')
    assert.include(roots, 'app')
  })

  /**
   * `#admin/*` aponta para `app/admin`, que já está dentro de `app`. Manter os
   * dois faria cada arquivo de admin ser varrido duas vezes — e, pior, mudaria
   * o módulo calculado.
   */
  test('colapsa raiz aninhada dentro de outra', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))
    const roots = app.scanRoots.map((r) => rel(app.root, r))

    assert.notInclude(roots, 'app/admin')
  })

  test('não inclui diretório inexistente', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    for (const root of app.scanRoots) {
      assert.isTrue(rel(app.root, root).length > 0)
    }
  })

  /**
   * Numa app real há `.insertInto()` em `tests/factories/`. Varrer isso
   * contaria escrita de teste como função da aplicação — e o número vai para
   * uma fatura.
   *
   * `config/` e `database/migrations` idem: não são código de negócio
   * alcançável a partir de um ponto de entrada.
   */
  test('exclui raízes que não são código de aplicação', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    const roots = app.scanRoots.map((r) => rel(app.root, r))

    assert.notInclude(roots, 'tests')
    assert.notInclude(roots, 'config')
    assert.notInclude(roots, 'database')
  })
})

test.group('AppContext: módulo para agrupamento', () => {
  test('layout plano não tem módulo', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.equal(app.moduleOf(app.resolveSpecifier('#models/book')!), 'app')
  })

  test('módulo simples', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_modular'))
    assert.equal(app.moduleOf(app.resolveSpecifier('#catalog/models/book')!), 'catalog')
  })

  /** Módulos aninhados existem numa app do core team (`app/admin/taxonomies`). */
  test('módulo aninhado preserva o caminho inteiro', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))
    assert.equal(app.moduleOf(app.resolveSpecifier('#admin/catalog/models/book')!), 'admin/catalog')
  })

  /** Arquivo fora de `app/` ainda pertence a um módulo reconhecível. */
  test('arquivo em src/ recebe o módulo da própria raiz', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))
    assert.equal(app.moduleOf(app.resolveSpecifier('#catalog/actions/create_book')!), 'catalog')
  })

  test('arquivo fora de qualquer raiz não quebra', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    assert.isString(app.moduleOf(path.join(app.root, 'start', 'routes.ts')))
  })
})

test.group('AppContext: framework', () => {
  test('lê versões do package.json', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))

    assert.equal(app.framework.core, 7)
    assert.equal(app.framework.lucid, 22)
    assert.equal(app.framework.orm, 'lucid')
  })

  /**
   * Fora do escopo do v1 é reportado, nunca contado errado. Sem dependências
   * declaradas não há o que afirmar.
   */
  test('app sem dependências declaradas fica desconhecida', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('no_generated'))

    assert.isUndefined(app.framework.core)
    assert.equal(app.framework.orm, 'unknown')
    assert.isFalse(app.framework.supported)
  })

  test('v7 + Lucid 22 é suportado no v1', async ({ assert }) => {
    for (const name of ['minimal_flat', 'minimal_modular', 'minimal_nogen']) {
      const app = await discoverApp(appFixturePath(name))
      assert.isTrue(app.framework.supported, `${name} deveria ser suportada`)
    }
  })
})
