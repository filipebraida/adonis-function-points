import type { HttpContext } from '@adonisjs/core/http'

import JustificarApontamento from '#ponto/actions/justificar_apontamento'
import { justificarApontamentoValidator } from '#ponto/validators/apontamento'

export default class JustificarApontamentoController {
  async handle({ request, response }: HttpContext) {
    const payload = await request.validateUsing(justificarApontamentoValidator)
    await new JustificarApontamento().handle(payload as never)
    return response.redirect().toRoute('apontamentos.index')
  }
}
