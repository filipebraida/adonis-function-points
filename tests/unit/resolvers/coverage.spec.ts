import { test } from '@japa/runner'
import fs from 'node:fs'

import { resolveCall } from '../../../src/inventory/resolvers/index.js'
import { fixturePath, loadFixture } from '../../helpers.js'

/**
 * Cada fixture em `patterns/` é A MESMA transação escrita de um jeito
 * diferente. Toda uma deve ser alcançável por alguma estratégia embutida.
 *
 * Este teste é a lista de pendências do pacote, em forma executável: quando
 * alguém adiciona uma fixture sem o resolvedor correspondente, ele falha.
 */

/** padrões cujo resolvedor ainda não existe — ver docs/design/resolvers.md */
const LACUNAS_CONHECIDAS = new Set([
  'property_service', // exige type checker para resolver o tipo da propriedade
])

/** qual estratégia DEVE reivindicar cada padrão — a ordem é parte do contrato */
const ESTRATEGIA_ESPERADA: Record<string, string> = {
  action_object: 'action-object',
  action_variable: 'action-object',
  job_dispatch: 'job-dispatch',
  static_service: 'static-service',
  module_function: 'module-function',
}

/** o fat controller escreve no próprio handler: é caso do detector, não de resolvedor */
const SEM_RESOLVEDOR_POR_DESIGN = new Set(['fat_controller'])

const patterns = fs
  .readdirSync(fixturePath('patterns'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

test.group('cobertura de padrões', () => {
  test('existe pelo menos uma fixture por padrão documentado', async ({ assert }) => {
    assert.isAbove(patterns.length, 4)
  })

  for (const pattern of patterns) {
    const esperado = !LACUNAS_CONHECIDAS.has(pattern) && !SEM_RESOLVEDOR_POR_DESIGN.has(pattern)

    test(`padrão "${pattern}" ${esperado ? 'é resolvido' : 'é lacuna conhecida'}`, async ({
      assert,
    }) => {
      const fixture = await loadFixture(pattern)
      const controller = fixture.controller()
      const ctx = fixture.contextFor(controller)

      const resolvido = fixture
        .callsIn(controller, 'handle')
        .some((call) => resolveCall(call, ctx) !== null)

      assert.equal(
        resolvido,
        esperado,
        esperado
          ? `nenhuma estratégia seguiu "${pattern}"`
          : `"${pattern}" passou a ser resolvido — remova de LACUNAS_CONHECIDAS`
      )
    })
  }

  /**
   * Regressão da armadilha que este teste descobriu: `Job.dispatch(p)` e
   * `Service.create(p)` são sintaticamente idênticos, e a genérica engolia o
   * job. Se alguém reordenar as estratégias, isto falha.
   */
  for (const [pattern, esperada] of Object.entries(ESTRATEGIA_ESPERADA)) {
    test(`"${pattern}" é reivindicado por "${esperada}"`, async ({ assert }) => {
      const fixture = await loadFixture(pattern)
      const controller = fixture.controller()
      const ctx = fixture.contextFor(controller)

      const reivindicacoes = fixture
        .callsIn(controller, 'handle')
        .map((call) => resolveCall(call, ctx))
        .filter((r): r is NonNullable<typeof r> => r !== null)

      assert.isNotEmpty(reivindicacoes)
      for (const r of reivindicacoes) assert.equal(r.by, esperada)
    })
  }
})
