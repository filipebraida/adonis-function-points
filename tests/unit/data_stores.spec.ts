import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectDataStores } from '../../src/inventory/sources/data_stores.js'
import type {
  CollectedDataStore,
  DataStoreCollection,
} from '../../src/inventory/sources/data_stores.js'
import { fixturePath } from '../helpers.js'

const collect = async (root: string) => collectDataStores(await discoverApp(root))

const namesOf = (store: CollectedDataStore) => store.attributes.map((a) => a.name).sort()

const storeNamed = (result: DataStoreCollection, name: string): CollectedDataStore => {
  const found = result.stores.find((s) => s.name === name)
  if (!found) throw new Error(`data store "${name}" não encontrado`)
  return found
}

/**
 * A falha que este grupo existe para tornar impossível: numa app levantada há
 * 35 arquivos de model e ZERO `extends BaseModel` do Lucid — os models estendem
 * classes de schema geradas. Detectar model pelo arquivo, sem seguir a cadeia
 * de herança, contaria zero para a aplicação inteira, em silêncio.
 */
test.group('funções de dados: estilos de definição', () => {
  const ESTILOS = ['direct', 'generated_schema', 'composed_mixin', 'custom_base']

  test('os quatro estilos descrevem as mesmas colunas', async ({ assert }) => {
    const esperado = ['createdAt', 'email', 'fullName', 'id']

    for (const style of ESTILOS) {
      const result = await collect(fixturePath('models', style))
      assert.deepEqual(namesOf(storeNamed(result, 'User')), esperado, `estilo ${style}`)
    }
  })

  test('encontra todos os models, não só o primeiro', async ({ assert }) => {
    for (const style of ESTILOS) {
      const result = await collect(fixturePath('models', style))
      assert.deepEqual(result.stores.map((s) => s.name).sort(), ['Post', 'User'], `estilo ${style}`)
    }
  })

  test('a chave primária é marcada como identificador', async ({ assert }) => {
    for (const style of ESTILOS) {
      const user = storeNamed(await collect(fixturePath('models', style)), 'User')
      const ids = user.attributes.filter((a) => a.isIdentifier).map((a) => a.name)
      assert.deepEqual(ids, ['id'], `estilo ${style}`)
    }
  })

  test('a tabela física vem de `static table`', async ({ assert }) => {
    const result = await collect(fixturePath('models', 'direct'))
    assert.equal(storeNamed(result, 'User').table, 'users')
    assert.equal(storeNamed(result, 'Post').table, 'posts')
  })

  /** Exigido pela identidade entre versões (counting-decisions §5). */
  test('relação de composição vira subgrupo candidato', async ({ assert }) => {
    const user = storeNamed(await collect(fixturePath('models', 'direct')), 'User')
    assert.include(user.subgroups, 'Post')
  })

  /** A procedência é requisito: um número sem origem é indefensável. */
  test('cada atributo carrega arquivo e linha', async ({ assert }) => {
    const user = storeNamed(await collect(fixturePath('models', 'direct')), 'User')
    for (const attribute of user.attributes) {
      assert.match(attribute.provenance.file, /\.ts$/)
      assert.isAbove(attribute.provenance.line ?? 0, 0)
    }
  })
})

test.group('funções de dados: fonte e fronteira', () => {
  /**
   * `static $columns` é lista canônica gerada das migrations. Quando existe,
   * prevalece sobre a leitura de decorators — e o `DataStore` registra isso,
   * porque contagem por AST e por schema gerado não são equivalentes.
   */
  test('registra de qual fonte as colunas vieram', async ({ assert }) => {
    const ast = storeNamed(await collect(fixturePath('models', 'direct')), 'User')
    assert.equal(ast.columnSource, 'ast')

    const generated = storeNamed(await collect(fixturePath('models', 'generated_schema')), 'User')
    assert.equal(generated.columnSource, 'generated-schema')
  })

  /**
   * O mixin `@acme/auditable` vem de specifier bare — fora da aplicação. O
   * pacote não tem como saber o que ele acrescenta.
   *
   * Dizer "não sei" é requisito: se um mixin de pacote acrescentasse uma coluna
   * (soft-delete acrescenta `deletedAt`), fingir que não existe seria contar
   * errado em silêncio. Ver counting-decisions §4.
   */
  test('mixin de pacote não resolvido entra na cobertura', async ({ assert }) => {
    const result = await collect(fixturePath('models', 'composed_mixin'))

    const external = result.unresolved.find((u) => u.expression === 'Auditable')
    assert.exists(external, 'mixin de pacote não foi reportado')
    assert.match(external!.reason, /fora da aplica/i)
  })

  /**
   * LACUNA CONHECIDA: fábrica de mixin (`compose(Base, withSlug())`) é local à
   * aplicação, mas a coluna só existe na classe que a função retorna. Resolver
   * isso exige avaliar o retorno da chamada — fora do escopo da Fase 2.
   *
   * O que NÃO é aceitável é reportar a razão errada: dizer "fora da aplicação"
   * para código que está dentro dela mandaria o usuário procurar no lugar
   * errado. Se um dia a fábrica for resolvida, este teste falha e a lacuna sai
   * da lista.
   */
  test('fábrica de mixin local é reportada pelo motivo certo', async ({ assert }) => {
    const result = await collect(fixturePath('models', 'composed_mixin'))
    const factory = result.unresolved.find((u) => u.expression.includes('withSlug'))

    assert.exists(factory, 'fábrica de mixin não foi reportada')
    assert.match(factory!.reason, /f[áa]brica de mixin/i)
    assert.notMatch(factory!.reason, /fora da aplica/i)
  })

  test('estilo sem mixin não inventa pendência', async ({ assert }) => {
    for (const style of ['direct', 'generated_schema']) {
      const result = await collect(fixturePath('models', style))
      assert.isEmpty(result.unresolved, `estilo ${style}`)
    }
  })

  /**
   * Uma classe base não tem tabela — contá-la infla a contagem.
   *
   * Não é caso de laboratório: 17 dos 34 models de uma app real estendem um
   * `BaseModel` próprio, que por sua vez estende o do Lucid por import
   * aliasado. Sem esta regra, essa classe vira um repositório de dados
   * fantasma em toda app que use o padrão.
   */
  test('classe usada como base por outro model não é repositório de dados', async ({ assert }) => {
    const result = await collect(fixturePath('models', 'custom_base'))

    assert.deepEqual(result.stores.map((s) => s.name).sort(), ['Post', 'User'])
    assert.notInclude(
      result.stores.map((s) => s.name),
      'BaseModel'
    )
  })

  /** Mas as colunas dela são herdadas por quem a estende. */
  test('colunas da base própria são herdadas', async ({ assert }) => {
    const user = storeNamed(await collect(fixturePath('models', 'custom_base')), 'User')
    assert.include(namesOf(user), 'createdAt')
  })

  /** O arquivo gerado é BASE dos models, não um model em si. */
  test('classes do schema gerado não viram data store', async ({ assert }) => {
    const result = await collect(fixturePath('models', 'generated_schema'))
    assert.notInclude(
      result.stores.map((s) => s.name),
      'UserSchema'
    )
  })
})
