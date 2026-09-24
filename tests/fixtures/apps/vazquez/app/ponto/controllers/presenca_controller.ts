import type { HttpContext } from '@adonisjs/core/http'

import Apontamento from '#ponto/models/apontamento'

import { periodoValidator } from '#ponto/validators/apontamento'

export default class PresencaController {
  /** Acompanhar Presença — total de horas do próprio trabalhador */
  async acompanhar({ request, inertia }: HttpContext) {
    const periodo = await request.validateUsing(periodoValidator)

    const apontamentos = await Apontamento.query()
      .preload('pessoa')
      .preload('justificativa')
      .orderBy('marcadoEm')

    const totalHoras = apontamentos.length / 2

    return inertia.render('ponto/acompanhar', { apontamentos, totalHoras, periodo })
  }

  /** Emitir Relatório de Presença — todos os trabalhadores */
  async relatorio({ request, inertia }: HttpContext) {
    const periodo = await request.validateUsing(periodoValidator)

    const apontamentos = await Apontamento.query()
      .preload('pessoa')
      .preload('justificativa')
      .orderBy('pessoaId')

    const totalHoras = apontamentos.length / 2

    return inertia.render('ponto/relatorio', { apontamentos, totalHoras, periodo })
  }
}
