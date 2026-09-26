import { Job } from '@adonisjs/queue'

import Notificacao from '#models/notificacao'

/** dispatched only by the inline listener of the string event `pedido:criado` */
export default class NotificarPedidoJob extends Job<{ pedidoId: number }> {
  async execute() {
    await Notificacao.create({ pedidoId: this.payload.pedidoId, mensagem: 'Pedido recebido' })
  }
}
