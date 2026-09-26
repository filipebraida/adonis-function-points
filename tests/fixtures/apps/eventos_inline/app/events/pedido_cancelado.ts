import { BaseEvent } from '@adonisjs/core/events'

/** a class event, bound to an inline arrow listener */
export default class PedidoCancelado extends BaseEvent {
  constructor(public pedidoId: number) {
    super()
  }
}
