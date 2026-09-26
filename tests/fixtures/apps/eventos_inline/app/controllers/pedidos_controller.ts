import type { HttpContext } from '@adonisjs/core/http'
import emitter from '@adonisjs/core/services/emitter'

import PedidoCancelado from '#events/pedido_cancelado'
import Pedido from '#models/pedido'

export default class PedidosController {
  /** emits a STRING event; the listener is an inline `async function` in start/events.ts */
  async store({ request, response }: HttpContext) {
    const pedido = await Pedido.create({ descricao: request.input('descricao'), status: 'novo' })
    await emitter.emit('pedido:criado', { pedidoId: pedido.id })
    return response.created({ id: pedido.id })
  }

  /** dispatches a CLASS event; the listener is an inline arrow in start/events.ts */
  async destroy({ params, response }: HttpContext) {
    const pedido = await Pedido.findOrFail(params.id)
    await pedido.delete()
    await PedidoCancelado.dispatch(pedido.id)
    return response.noContent()
  }
}
