import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import { calibrate, parseSamples } from '../../src/albrecht/calibration.js'
import { appFixturePath } from '../helpers.js'

/**
 * O benchmark Vazquez é também o conjunto de calibração: 10 funções com valor
 * manual publicado. Calibrar contra ele mede o viés real do contador, e não
 * contra números que nós mesmos produzimos.
 */
const AMOSTRAS_VAZQUEZ = `# funcao,pf — gabarito de Vazquez et al. (2011)
funcao,pf
Pessoa,5
Justificativa,7
Apontamento,7
GET /apontamentos,3
POST /apontamentos,3
PUT /apontamentos/:param,4
DELETE /apontamentos/:param,3
POST /apontamentos/justificar,4
GET /presenca,5
GET /presenca/relatorio,5
`

const calibrarVazquez = async () => {
  const { count } = await analyze(appFixturePath('vazquez'), {
    externallyMaintained: ['Pessoa'],
  })
  return calibrate(count, parseSamples(AMOSTRAS_VAZQUEZ))
}

test.group('calibração: leitura das amostras', () => {
  test('lê CSV com cabeçalho e comentário', async ({ assert }) => {
    const samples = parseSamples(AMOSTRAS_VAZQUEZ)

    assert.lengthOf(samples, 10)
    assert.deepEqual(samples[0], { function: 'Pessoa', manual: 5 })
  })

  /** Identidade de rota tem vírgula? Não — mas o nome pode ter, e o PF é o último campo. */
  test('separa pelo último campo, não pelo primeiro', async ({ assert }) => {
    const samples = parseSamples('funcao,pf\n"GET /a,b",4\n')
    assert.deepEqual(samples, [{ function: 'GET /a,b', manual: 4 }])
  })

  test('recusa linha com PF ilegível em vez de ignorar', async ({ assert }) => {
    assert.throws(() => parseSamples('funcao,pf\nPOST /books,abc\n'), /PF ilegível/)
  })

  test('ignora linhas vazias', async ({ assert }) => {
    assert.lengthOf(parseSamples('funcao,pf\n\nPessoa,5\n\n'), 1)
  })
})

test.group('calibração: viés medido', () => {
  test('mede o desvio do total contra a contagem manual', async ({ assert }) => {
    const calibration = await calibrarVazquez()

    assert.equal(calibration.overall.samples, 10)
    assert.equal(calibration.overall.manualPoints, 46)
    assert.equal(calibration.overall.automaticPoints, 46)
    assert.equal(calibration.overall.deviation, 0)
  })

  /**
   * O total bate, mas duas funções divergem e se cancelam. A calibração por
   * TIPO é o que revela isso — e é por tipo que o viés se corrige.
   */
  test('o fator por tipo revela o viés que o total esconde', async ({ assert }) => {
    const calibration = await calibrarVazquez()

    const eo = calibration.byType.find((item) => item.type === 'EO')!
    const ei = calibration.byType.find((item) => item.type === 'EI')!

    // SE superestima (CE colapsado em SE vale mais), EE subestima (DET de mensagem)
    assert.isBelow(eo.factor, 1, 'SE deveria estar superestimado')
    assert.isAbove(ei.factor, 1, 'EE deveria estar subestimado')
  })

  test('conta quantas funções batem exatamente', async ({ assert }) => {
    const calibration = await calibrarVazquez()
    assert.equal(calibration.overall.exactMatches, 8)
  })

  test('as funções de dados não têm viés nenhum', async ({ assert }) => {
    const calibration = await calibrarVazquez()

    for (const type of ['ILF', 'EIF'] as const) {
      const item = calibration.byType.find((entry) => entry.type === type)
      if (!item) continue
      assert.equal(item.factor, 1, `${type} deveria bater exatamente`)
      assert.equal(item.meanAbsoluteDeviation, 0)
    }
  })
})

test.group('calibração: guardas contra número enganoso', () => {
  /**
   * Um "fator" tirado de duas funções é ruído. Usá-lo para corrigir contagem é
   * pior que não corrigir — e o número sairia numa fatura.
   */
  test('avisa quando a amostra é pequena demais para o fator valer', async ({ assert }) => {
    const calibration = await calibrarVazquez()

    assert.isNotEmpty(calibration.warnings)
    assert.isTrue(
      calibration.warnings.some((w) => /abaixo do mínimo/.test(w)),
      'amostra de 10 funções tem poucos casos por tipo'
    )
  })

  test('amostra que não casa é reportada, não descartada', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('vazquez'))
    const calibration = calibrate(count, [
      { function: 'POST /inexistente', manual: 4 },
      { function: 'Apontamento', manual: 7 },
    ])

    assert.deepEqual(calibration.unmatched, ['POST /inexistente'])
    assert.isTrue(calibration.warnings.some((w) => /não casaram/.test(w)))
  })

  /**
   * Se tudo bate exatamente, a suspeita mais provável não é que o contador seja
   * perfeito — é que a "contagem manual" saiu da automática.
   */
  test('desconfia quando tudo bate exatamente', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))
    const calibration = calibrate(
      count,
      count.functions.map((fn) => ({ function: fn.name, manual: fn.points }))
    )

    assert.isTrue(
      calibration.warnings.some((w) => /calibrar contra si mesmo/.test(w)),
      'bater 100% deveria levantar suspeita, não comemoração'
    )
  })

  test('não aplica o fator automaticamente', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('vazquez'), {
      externallyMaintained: ['Pessoa'],
    })
    const antes = count.totals.unadjusted

    calibrate(count, parseSamples(AMOSTRAS_VAZQUEZ))

    assert.equal(
      count.totals.unadjusted,
      antes,
      'calibrar é decisão de quem assina o contrato, não efeito colateral'
    )
  })
})
