import { test } from '@japa/runner'

import { DEFAULT_WEIGHTS, complexityOf, pointsOf } from '../../src/albrecht/tables.js'

/**
 * Casos retirados do estudo de caso de Vazquez, Simões e Albert (2011),
 * o mesmo gabarito usado pela dissertação do Ligeiro.
 */
test.group('tabelas de complexidade IFPUG', () => {
  test('ALI com 1 RET e poucos DETs é baixa', ({ assert }) => {
    assert.equal(complexityOf('ILF', 1, 3), 'low')
    assert.equal(pointsOf('ILF', 'low'), 7)
  })

  test('AIE vale menos que ALI na mesma complexidade', ({ assert }) => {
    assert.isBelow(pointsOf('EIF', 'low'), pointsOf('ILF', 'low'))
    assert.equal(pointsOf('EIF', 'low'), 5)
  })

  test('EE com 2 FTR e 5 DETs é média', ({ assert }) => {
    assert.equal(complexityOf('EI', 2, 5), 'average')
    assert.equal(pointsOf('EI', 'average'), 4)
  })

  test('EE com 2 FTR e 4 DETs ainda é baixa', ({ assert }) => {
    assert.equal(complexityOf('EI', 2, 4), 'low')
  })

  test('SE tem faixas de DET mais largas que EE', ({ assert }) => {
    // 5 DETs: média para EE, baixa para SE
    assert.equal(complexityOf('EI', 2, 5), 'average')
    assert.equal(complexityOf('EO', 2, 5), 'low')
  })

  test('SE vale mais que EE na mesma complexidade', ({ assert }) => {
    assert.isAbove(pointsOf('EO', 'low'), pointsOf('EI', 'low'))
  })

  /**
   * O achado que justifica tabelas configuráveis: no Ligeiro, a mensagem de
   * confirmação — invisível para análise estática — era 1 DET, e isso bastou
   * para cruzar a faixa e mudar o valor da função de 4 para 3.
   */
  test('1 DET a menos pode mudar a faixa e o valor', ({ assert }) => {
    const comMensagem = complexityOf('EI', 2, 5)
    const semMensagem = complexityOf('EI', 2, 4)
    assert.notEqual(comMensagem, semMensagem)
    assert.notEqual(pointsOf('EI', comMensagem), pointsOf('EI', semMensagem))
  })

  test('todos os tipos têm peso para todas as complexidades', ({ assert }) => {
    for (const type of ['ILF', 'EIF', 'EI', 'EO', 'EQ'] as const)
      for (const cx of ['low', 'average', 'high'] as const)
        assert.isNumber(DEFAULT_WEIGHTS[type][cx])
  })
})
