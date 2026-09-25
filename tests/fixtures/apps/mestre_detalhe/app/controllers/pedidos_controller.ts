import type { HttpContext } from '@adonisjs/core/http'

import Pedido from '#models/pedido'
import {
  adicionarItemValidator,
  comentarValidator,
  criarPedidoValidator,
} from '#validators/pedido'

export default class PedidosController {
  /** the order with its lines: one logical file, one FTR */
  async index({ inertia }: HttpContext) {
    const pedidos = await Pedido.query().preload('itens').orderBy('emitidoEm', 'desc')
    return inertia.render('pedidos/index', { pedidos })
  }

  /** the group, plus two stores that stay their own: three FTRs */
  async show({ params, inertia }: HttpContext) {
    const pedido = await Pedido.query()
      .where('id', params.id)
      .preload('itens')
      .preload('comentarios')
      .preload('etiquetas')
      .firstOrFail()

    return inertia.render('pedidos/show', { pedido })
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(criarPedidoValidator)
    await Pedido.create({ ...payload, status: 'aberto', total: 0 })
    return response.redirect().toRoute('pedidos.index')
  }

  /** writes the detail through the master: maintains the group */
  async addItem({ params, request, response }: HttpContext) {
    const payload = await request.validateUsing(adicionarItemValidator)
    const pedido = await Pedido.findOrFail(params.id)
    await pedido.related('itens').create(payload)
    return response.redirect().toRoute('pedidos.show', { id: pedido.id })
  }

  /** writes a child that is its own file: the group plus `Comentario` */
  async comment({ params, request, response }: HttpContext) {
    const payload = await request.validateUsing(comentarValidator)
    const pedido = await Pedido.findOrFail(params.id)
    await pedido.related('comentarios').create(payload)
    return response.redirect().toRoute('pedidos.show', { id: pedido.id })
  }
}
