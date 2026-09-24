import type { HttpContext } from '@adonisjs/core/http'

import Apontamento from '#ponto/models/apontamento'
import Justificativa from '#ponto/models/justificativa'

import RegistrarPonto from '#ponto/actions/registrar_ponto'

import {
  alterarApontamentoValidator,
  registrarPontoValidator,
} from '#ponto/validators/apontamento'

export default class ApontamentosController {
  /** Consulta Apontamento Diário — apresenta os apontamentos do dia */
  async index({ inertia }: HttpContext) {
    const apontamentos = await Apontamento.query().orderBy('marcadoEm')
    return inertia.render('ponto/diario', { apontamentos })
  }

  /** Registro de Ponto */
  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(registrarPontoValidator)
    await new RegistrarPonto().handle(payload as never)
    return response.redirect().toRoute('apontamentos.index')
  }

  /** Alteração de Apontamento — altera o registro e grava a justificativa */
  async update({ params, request, response }: HttpContext) {
    const payload = await request.validateUsing(alterarApontamentoValidator)
    const apontamento = await Apontamento.findOrFail(params.id)

    const justificativa = await Justificativa.create({
      pessoaId: apontamento.pessoaId,
      motivo: payload.motivo,
      observacao: payload.observacao ?? null,
    })

    apontamento.tipo = payload.tipo
    apontamento.justificativaId = justificativa.id
    await apontamento.save()

    return response.redirect().toRoute('apontamentos.index')
  }

  /** Exclusão de Apontamento */
  async destroy({ params, response }: HttpContext) {
    const apontamento = await Apontamento.findOrFail(params.id)
    await apontamento.load('justificativa')
    await apontamento.delete()
    return response.redirect().toRoute('apontamentos.index')
  }
}
