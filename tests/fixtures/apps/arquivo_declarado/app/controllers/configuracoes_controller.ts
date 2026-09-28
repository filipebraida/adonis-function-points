import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

import AgendaService from '#services/agenda_service'
import ConfiguracoesService from '#services/configuracoes_service'

@inject()
export default class ConfiguracoesController {
  constructor(
    protected configuracoes: ConfiguracoesService,
    protected agenda: AgendaService
  ) {}

  async show({ response }: HttpContext) {
    const config = await this.configuracoes.get()
    return response.json({ prazoDias: config.prazoDias, metaPct: config.metaPct })
  }

  async update({ request, response }: HttpContext) {
    await this.configuracoes.atualizar({
      prazoDias: request.input('prazoDias'),
      metaPct: request.input('metaPct'),
    })
    return response.redirect('/configuracoes')
  }

  async agendamentos({ request, response }: HttpContext) {
    const agendamentos = await this.agenda.listarPorPessoa(request.input('cpf'))
    return response.json({ agendamentos })
  }
}
