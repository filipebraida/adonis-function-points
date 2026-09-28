import type { HttpContext } from '@adonisjs/core/http'
import permissoes from '@acme/permissoes/services/main'

import { criarPapel } from '#actions/criar_papel'
import { excluirPapel } from '#actions/excluir_papel'

/** roles the administrator maintains — stored by the authorization package, never by a model */
export default class PapeisController {
  async index({ response }: HttpContext) {
    const papeis = await permissoes.store.listarPapeis()
    return response.json({ papeis })
  }

  async store({ request, response }: HttpContext) {
    await criarPapel(request.input('nome'))
    return response.redirect('/papeis')
  }

  async destroy({ params, response }: HttpContext) {
    await excluirPapel(params.nome)
    return response.redirect('/papeis')
  }
}
