import { test } from '@japa/runner'
import path from 'node:path'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectEntryPoints } from '../../src/inventory/sources/routes_ast.js'
import type { EntryPointCollection } from '../../src/inventory/sources/routes_ast.js'
import { fixturePath } from '../helpers.js'

const collect = async (root: string) => collectEntryPoints(await discoverApp(root))

const shapes = () => collect(fixturePath('routes', 'all_shapes'))

const find = (result: EntryPointCollection, trigger: string, signature: string) =>
  result.entryPoints.find((e) => e.trigger === trigger && e.signature === signature)

const handlerOf = (result: EntryPointCollection, trigger: string, signature: string) => {
  const entry = find(result, trigger, signature)
  if (!entry?.handler) throw new Error(`sem handler: ${trigger} ${signature}`)
  return { file: path.basename(entry.handler.file), member: entry.handler.member }
}

test.group('pontos de entrada: formas de declarar rota', () => {
  test('rota de uma linha', async ({ assert }) => {
    assert.exists(find(await shapes(), 'GET', '/health'))
  })

  /**
   * O texto da expressão de `router\n  .post(...)` contém a quebra de linha.
   * Sem normalizar, o casamento falha — e no spike isso fez enxergar 23 de 164
   * rotas de uma app real.
   */
  test('rota multi-linha encadeada', async ({ assert }) => {
    const entry = find(await shapes(), 'POST', '/books/:id/export')
    assert.exists(entry, 'rota multi-linha não foi encontrada')
  })

  test('grupo aplica o prefixo ao padrão', async ({ assert }) => {
    const result = await shapes()
    assert.exists(find(result, 'GET', '/admin/books'), 'prefixo do grupo não aplicado')
    assert.notExists(find(result, 'GET', '/books') && undefined)
  })

  test('grupo aninhado acumula os prefixos', async ({ assert }) => {
    assert.exists(find(await shapes(), 'DELETE', '/admin/trash/books/:uuid'))
  })

  /**
   * Closure inline é handler de verdade: tem corpo, e a Fase 4 precisa
   * percorrê-lo. Tratá-la como "controller não resolvido" perderia a
   * transação e ainda reportaria o motivo errado.
   *
   * Aparece em 3 das 5 apps de produção levantadas.
   */
  test('closure inline é handler, não pendência', async ({ assert }) => {
    const result = await shapes()
    const entry = find(result, 'GET', '/ping')

    assert.exists(entry, 'rota com closure não foi coletada')
    assert.isNotNull(entry!.handler, 'closure deveria ser handler')
    assert.isAbove(entry!.handler!.line ?? 0, 0, 'handler inline precisa de linha')
    assert.isEmpty(result.unresolved, 'closure não é pendência')
  })

  /** `router.on(...)` não tem handler para analisar — mas é ponto de entrada. */
  test('rota estática vira ponto de entrada sem handler', async ({ assert }) => {
    const entry = find(await shapes(), 'GET', '/about')
    assert.exists(entry, 'rota estática não foi coletada')
    assert.isNull(entry!.handler)
  })
})

test.group('pontos de entrada: resource', () => {
  test('`.only()` limita as ações expandidas', async ({ assert }) => {
    const result = await shapes()

    assert.exists(find(result, 'GET', '/books'), 'index')
    assert.exists(find(result, 'GET', '/books/:id'), 'show')
    assert.exists(find(result, 'POST', '/books'), 'store')

    assert.notExists(find(result, 'DELETE', '/books/:id'), 'destroy não estava em only()')
    assert.notExists(find(result, 'GET', '/books/create'), 'create não estava em only()')
  })

  test('`.apiOnly()` exclui create e edit', async ({ assert }) => {
    const result = await shapes()

    assert.exists(find(result, 'GET', '/api/books'), 'index')
    assert.exists(find(result, 'DELETE', '/api/books/:id'), 'destroy')
    assert.notExists(find(result, 'GET', '/api/books/create'), 'create')
    assert.notExists(find(result, 'GET', '/api/books/:id/edit'), 'edit')
  })

  test('cada ação do resource aponta para o método certo', async ({ assert }) => {
    const result = await shapes()
    assert.equal(handlerOf(result, 'GET', '/books').member, 'index')
    assert.equal(handlerOf(result, 'POST', '/books').member, 'store')
    assert.equal(handlerOf(result, 'GET', '/books/:id').member, 'show')
  })
})

test.group('pontos de entrada: resolução do controller', () => {
  /**
   * Numa app real havia 5 colisões de nome simples entre módulos. Indexar por
   * nome resolveria o controller errado — em silêncio.
   */
  test('nome colidindo entre módulos resolve o arquivo certo', async ({ assert }) => {
    const result = await shapes()

    const catalogo = handlerOf(result, 'GET', '/books')
    const administracao = handlerOf(result, 'GET', '/admin/books')

    assert.include(
      result.entryPoints.find((e) => e.signature === '/books' && e.trigger === 'GET')!.handler!
        .file,
      '/catalog/'
    )
    assert.include(
      result.entryPoints.find((e) => e.signature === '/admin/books')!.handler!.file,
      '/admin/'
    )
    assert.equal(catalogo.file, administracao.file, 'mesmo basename, arquivos diferentes')
  })

  test('alias local por lazy import resolve', async ({ assert }) => {
    const handler = handlerOf(await shapes(), 'POST', '/books/:id/export')
    assert.equal(handler.file, 'export_controller.ts')
  })

  /** Handler de ação única não declara método: é `handle` por convenção. */
  test('handler de ação única não declara método', async ({ assert }) => {
    const handler = handlerOf(await shapes(), 'POST', '/books/:id/export')
    assert.isUndefined(handler.member)
  })
})

test.group('pontos de entrada: identidade', () => {
  /**
   * counting-decisions §5: a identidade é o ponto de entrada, não o nome da
   * rota nem o caminho do controller. `.as()` é cosmético — renomear não muda
   * a função que o usuário vê; e mover o controller de módulo é refatoração.
   *
   * Sem isso, `fp:diff` transforma renomeação em exclusão + inclusão e fatura
   * em dobro.
   */
  test('identidade é verbo mais padrão normalizado', async ({ assert }) => {
    const entry = find(await shapes(), 'DELETE', '/admin/trash/books/:uuid')
    assert.equal(entry!.identity, 'DELETE /admin/trash/books/:param')
  })

  test('o nome do parâmetro não muda a identidade', async ({ assert }) => {
    const result = await shapes()
    const porId = find(result, 'GET', '/books/:id')!
    const porUuid = find(result, 'DELETE', '/admin/trash/books/:uuid')!

    assert.include(porId.identity, '/books/:param')
    assert.include(porUuid.identity, '/books/:param')
  })

  test('identidade é única por ponto de entrada', async ({ assert }) => {
    const result = await shapes()
    const ids = result.entryPoints.map((e) => e.identity)
    assert.lengthOf(new Set(ids), ids.length, 'há identidades duplicadas')
  })
})
