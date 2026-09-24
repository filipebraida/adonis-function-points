import { test } from '@japa/runner'

import { CoverageTooLowError, analyze } from '../../src/pipeline.js'
import { diffCounts } from '../../src/albrecht/diff.js'
import { renderCount, renderDiff, renderExplain } from '../../src/reporters/table.js'
import { appFixturePath } from '../helpers.js'

test.group('pipeline', () => {
  test('produz inventário e contagem numa passada', async ({ assert }) => {
    const { inventory, count } = await analyze(appFixturePath('minimal_flat'))

    assert.equal(inventory.version, 1)
    assert.isNotEmpty(inventory.dataStores)
    assert.isNotEmpty(inventory.entryPoints)
    assert.isAbove(count.totals.unadjusted, 0)
  })

  test('o inventário registra em que framework a contagem foi feita', async ({ assert }) => {
    const { inventory } = await analyze(appFixturePath('minimal_flat'))

    assert.equal(inventory.framework.core, 7)
    assert.equal(inventory.framework.orm, 'lucid')
  })

  /**
   * Um número com rastreamento ruim não deveria virar fatura. O pacote prefere
   * falhar a emitir algo que parece certo.
   */
  test('falha quando a cobertura fica abaixo do mínimo', async ({ assert }) => {
    await assert.rejects(
      () => analyze(appFixturePath('minimal_flat'), { minCoverage: 1.01 }),
      CoverageTooLowError
    )
  })

  test('a mensagem diz o que fazer, não só que falhou', async ({ assert }) => {
    try {
      await analyze(appFixturePath('minimal_flat'), { minCoverage: 1.01 })
      assert.fail('deveria ter falhado')
    } catch (error) {
      assert.match((error as Error).message, /fp:inventory/)
    }
  })

  test('sem mínimo configurado, não bloqueia', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('edges_boundary'))
    assert.isAbove(count.totals.unadjusted, 0)
  })

  /**
   * As três apps da invariante passam pelo pipeline inteiro com o mesmo total —
   * a invariante de ouro valendo de ponta a ponta, não só no motor.
   */
  test('as três apps da invariante dão o mesmo total pelo pipeline', async ({ assert }) => {
    const totais = await Promise.all(
      ['minimal_flat', 'minimal_modular', 'minimal_nogen'].map(async (name) => {
        const { count } = await analyze(appFixturePath(name))
        return count.totals.unadjusted
      })
    )

    assert.deepEqual(totais, [totais[0], totais[0], totais[0]])
  })
})

test.group('relatório: contagem', () => {
  test('mostra total, ruleset e as funções', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const texto = renderCount(count)

    assert.match(texto, /Contagem não ajustada: \d+ PF/)
    assert.include(texto, 'afp@')
    assert.include(texto, 'POST /books')
  })

  /**
   * O AFP §6.5.3 exige que o que faltou apareça no relatório. Um total sem a
   * confiança ao lado convida a tratá-lo como exato.
   */
  test('a confiança aparece junto do número quando há o que reportar', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('edges_boundary'))
    const texto = renderCount(count)

    assert.include(texto, 'Confiança:')
    assert.include(texto, 'UserSession', 'a exclusão técnica precisa estar visível')
  })
})

test.group('relatório: explain', () => {
  /**
   * `fp:explain` é o que sustenta contestação. Tem que mostrar a regra da
   * norma, a origem de cada DET e de cada FTR, e o caminho percorrido.
   */
  test('mostra regra, origem dos DETs e origem dos FTRs', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const texto = renderExplain(count.functions.find((f) => f.name === 'POST /books')!)

    assert.match(texto, /Regra aplicada: afp:/)
    assert.include(texto, 'DET =')
    assert.include(texto, 'FTR =')
    assert.include(texto, 'validator:')
  })

  test('mostra o caminho percorrido, com quem resolveu cada passo', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const texto = renderExplain(count.functions.find((f) => f.name === 'POST /books')!)

    assert.include(texto, 'Caminho percorrido:')
    assert.include(texto, 'action-object', 'o rastro tem que dizer qual estratégia resolveu')
    assert.include(texto, '[escreve]', 'e onde a escrita acontece')
  })

  test('função de dados mostra RET, não FTR', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const texto = renderExplain(count.functions.find((f) => f.name === 'Book')!)

    assert.include(texto, 'RET =')
    assert.notInclude(texto, 'FTR =')
  })
})

test.group('relatório: diff', () => {
  test('mostra faturável e detalha só o que mudou', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const reduzida = { ...count, functions: count.functions.slice(1) }

    const texto = renderDiff(diffCounts(count, reduzida))

    assert.match(texto, /PF faturável: [\d.]+/)
    assert.include(texto, 'removed')

    // o RESUMO mostra quantas ficaram inalteradas — isso é informação útil;
    // o DETALHE lista só o que mudou, senão uma release pequena vira parede
    const detalhe = texto.slice(texto.indexOf('PF faturável'))
    assert.notInclude(detalhe, 'unchanged')
    assert.include(texto.slice(0, texto.indexOf('PF faturável')), 'unchanged')
  })

  test('o aviso sobre o fator de alteração aparece no texto', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const alterada = {
      ...count,
      functions: count.functions.map((fn) => ({ ...fn, scopeHash: 'outro' })),
    }

    const texto = renderDiff(diffCounts(count, alterada))
    assert.match(texto, /Atenção:.*Effort Complexity/s)
  })
})
