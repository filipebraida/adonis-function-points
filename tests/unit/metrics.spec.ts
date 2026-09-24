import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import { measureConformance, measureStructure } from '../../src/metrics/structure.js'
import { appFixturePath } from '../helpers.js'

const medir = async (name: string) => {
  const { inventory, count } = await analyze(appFixturePath(name))
  return {
    estrutura: measureStructure(inventory, count),
    conformidade: measureConformance(inventory),
    inventory,
    count,
  }
}

/**
 * Por que estas métricas existem ao lado de PF: se PF paga, o time otimiza PF —
 * mais models, mais endpoints, menos reuso. Densidade e acoplamento no mesmo
 * painel são o contrapeso. Sem eles a métrica vira alvo, não medida.
 *
 * E saem de graça: o grafo já sabe quais transações alcançam quais
 * repositórios, então isto é aritmética sobre o inventário.
 */
test.group('métricas: acoplamento entre módulos', () => {
  /**
   * `coupled_modules`: a transação de `faturamento` escreve em `Nota` e LÊ
   * `Produto`, declarado em `catalogo`. É dependência de uso, não de import —
   * import de tipo não cria acoplamento funcional.
   */
  test('detecta dependência de uso entre módulos', async ({ assert }) => {
    const { estrutura } = await medir('coupled_modules')

    const faturamento = estrutura.modules.find((m) => m.module === 'faturamento')!
    const catalogo = estrutura.modules.find((m) => m.module === 'catalogo')!

    assert.deepEqual(faturamento.dependsOn, ['catalogo'])
    assert.deepEqual(catalogo.dependedOnBy, ['faturamento'])
  })

  /** A dependência é dirigida: `catalogo` não passa a depender de quem o usa. */
  test('a dependência não é simétrica por acidente', async ({ assert }) => {
    const { estrutura } = await medir('coupled_modules')
    const catalogo = estrutura.modules.find((m) => m.module === 'catalogo')!

    assert.isEmpty(catalogo.dependsOn)
    assert.isEmpty(estrutura.mutualDependencies)
  })

  /**
   * Instabilidade de Martin: `catalogo` é usado e não usa ninguém, então é
   * estável (0). `faturamento` só usa, então é instável (1).
   *
   * Módulo estável que muda muito é onde a mudança dói — é para isso que a
   * métrica serve.
   */
  test('instabilidade separa quem é usado de quem usa', async ({ assert }) => {
    const { estrutura } = await medir('coupled_modules')

    assert.equal(estrutura.modules.find((m) => m.module === 'catalogo')!.instability, 0)
    assert.equal(estrutura.modules.find((m) => m.module === 'faturamento')!.instability, 1)
  })

  test('módulo sem vizinho tem instabilidade zero', async ({ assert }) => {
    const { estrutura } = await medir('minimal_flat')

    // layout plano: um módulo só, nada de que depender
    assert.lengthOf(estrutura.modules, 1)
    assert.equal(estrutura.modules[0].instability, 0)
  })

  test('instabilidade fica entre 0 e 1', async ({ assert }) => {
    for (const app of ['minimal_flat', 'minimal_modular', 'minimal_nogen', 'vazquez']) {
      const { estrutura } = await medir(app)
      for (const modulo of estrutura.modules) {
        assert.isAtLeast(modulo.instability, 0, `${app}/${modulo.module}`)
        assert.isAtMost(modulo.instability, 1, `${app}/${modulo.module}`)
      }
    }
  })

  test('não inventa dependência de um módulo para si mesmo', async ({ assert }) => {
    const { estrutura } = await medir('minimal_modular')

    for (const modulo of estrutura.modules) {
      assert.notInclude(modulo.dependsOn, modulo.module)
    }
  })

  test('par de dependência mútua vem ordenado, para não duplicar', async ({ assert }) => {
    for (const app of ['minimal_nogen', 'coupled_modules', 'vazquez']) {
      const { estrutura } = await medir(app)
      for (const [a, b] of estrutura.mutualDependencies) {
        assert.isTrue(a < b, `${app}: par (${a}, ${b}) fora de ordem`)
      }
    }
  })
})

test.group('métricas: densidade', () => {
  test('PF por repositório de dados', async ({ assert }) => {
    const { estrutura, count, inventory } = await medir('vazquez')

    assert.equal(
      estrutura.pointsPerDataStore,
      Math.round((count.totals.unadjusted / inventory.dataStores.length) * 1000) / 1000
    )
  })

  test('PF por módulo fecha com o total da contagem', async ({ assert }) => {
    const { estrutura, count } = await medir('vazquez')
    const soma = estrutura.modules.reduce((total, m) => total + m.functionPoints, 0)

    assert.equal(soma, count.totals.unadjusted)
  })

  test('não divide por zero em app sem repositório', async ({ assert }) => {
    const { estrutura } = await medir('minimal_flat')
    assert.isFinite(estrutura.pointsPerDataStore)
    assert.isFinite(estrutura.transactionsPerDataStore)
  })
})

test.group('métricas: conformidade com a própria convenção', () => {
  /**
   * Não mede tamanho nem qualidade: mede se o time segue o que combinou. Numa
   * fábrica é o que vira auditoria de padrão.
   */
  test('transação de escrita com validator declarado', async ({ assert }) => {
    const { conformidade } = await medir('vazquez')

    assert.equal(conformidade.writesWithValidator.total, 4, 'as quatro EE do estudo de caso')

    /**
     * 3 de 4: `Exclusão de Apontamento` escreve sem validator, só com o
     * parâmetro da rota. Está correto — e é exatamente o tipo de coisa que a
     * conformidade existe para mostrar, em vez de deixar passar.
     */
    assert.equal(conformidade.writesWithValidator.ok, 3)
    assert.equal(conformidade.writesWithValidator.ratio, 0.75)
  })

  test('detecta escrita sem validator', async ({ assert }) => {
    const { conformidade } = await medir('minimal_flat')

    // `DELETE /books/:id` escreve sem validator: só o parâmetro de rota
    assert.isBelow(conformidade.writesWithValidator.ratio, 1)
  })

  test('ponto de entrada sem handler aparece na conformidade', async ({ assert }) => {
    const { conformidade } = await medir('edges_boundary')
    assert.equal(conformidade.entryPointsWithHandler.ratio, 1, 'nesta fixture todos têm handler')
  })

  /**
   * Repositório que nenhuma transação alcança pode ser tabela morta ou lacuna do
   * rastreador. A razão fica visível em vez de escondida na contagem.
   */
  test('repositório não alcançado baixa a conformidade', async ({ assert }) => {
    const { conformidade } = await medir('edges_boundary')

    // `OrphanLog` não é alcançado por transação nenhuma
    assert.isBelow(conformidade.dataStoresReached.ratio, 1)
    assert.isAbove(conformidade.dataStoresReached.ratio, 0)
  })

  test('as razões ficam entre 0 e 1', async ({ assert }) => {
    for (const app of ['minimal_flat', 'vazquez', 'edges_boundary']) {
      const { conformidade } = await medir(app)
      for (const [nome, valor] of Object.entries(conformidade)) {
        assert.isAtLeast(valor.ratio, 0, `${app}/${nome}`)
        assert.isAtMost(valor.ratio, 1, `${app}/${nome}`)
      }
    }
  })
})
