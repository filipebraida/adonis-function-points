import emitter from '@adonisjs/core/services/emitter'

import PedidoCancelado from '#events/pedido_cancelado'
import NotificarPedidoJob from '#jobs/notificar_pedido_job'
import Auditoria from '#models/auditoria'

/** a string event, listened to by an inline function that dispatches a job */
emitter.on('pedido:criado', async function ({ pedidoId }: { pedidoId: number }) {
  await NotificarPedidoJob.dispatch({ pedidoId })
})

/** a class event, listened to by an inline arrow that writes directly */
emitter.on(PedidoCancelado, async (event) => {
  await Auditoria.create({ pedidoId: event.pedidoId, acao: 'cancelado' })
})
