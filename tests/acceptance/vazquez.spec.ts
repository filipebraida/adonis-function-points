import { test } from '@japa/runner'

/**
 * Benchmark público: o estudo de caso de Vazquez, Simões e Albert (2011) tem
 * contagem manual publicada de 56 PF não ajustados, e foi o gabarito usado
 * pela dissertação do Ligeiro (Pinel, 2012), que chegou a 52 PF — ~7% de
 * desvio, com divergências sistemáticas e explicáveis.
 *
 * É o teste de aceitação do motor. Enquanto os coletores não existem, fica
 * registrado aqui para não se perder.
 *
 * Divergências esperadas, de docs/research/spike-findings.md:
 *   - mensagens de confirmação: 1 DET a menos por FT
 *   - ARs por dependência de código ficam maiores que a visão do usuário
 *   - SE vs CE indecidível estaticamente (o AFP colapsa em SE)
 */
test.group('aceitação: estudo de caso Vazquez et al. (2011)', () => {
  test('conta 56 PF não ajustados, com tolerância de 10%', ({ assert }) => {
    assert.isTrue(true)
  }).skip(true, 'aguarda os coletores da Fase 1')

  test('identifica 2 ALI e 1 AIE', ({ assert }) => {
    assert.isTrue(true)
  }).skip(true, 'aguarda os coletores da Fase 1')
})
