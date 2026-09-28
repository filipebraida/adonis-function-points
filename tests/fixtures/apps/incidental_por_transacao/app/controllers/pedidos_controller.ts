import type { HttpContext } from '@adonisjs/core/http'

import { lembrarOrganizacao } from '#actions/lembrar_organizacao'
import Pedido from '#models/pedido'

export default class PedidosController {
  /** shows the order — and remembers the organisation on the way */
  async show({ params, response }: HttpContext) {
    const pedido = await Pedido.findOrFail(params.id)
    await lembrarOrganizacao(pedido.id)
    return response.json({ descricao: pedido.descricao, status: pedido.status })
  }

  /** the user switches organisation: remembering it IS the point */
  async trocar({ request, response }: HttpContext) {
    await lembrarOrganizacao(request.input('organizacao'))
    return response.redirect('/pedidos')
  }

  async store({ request, response }: HttpContext) {
    await Pedido.create({ descricao: request.input('descricao'), status: 'aberto' })
    return response.redirect('/pedidos')
  }
}
