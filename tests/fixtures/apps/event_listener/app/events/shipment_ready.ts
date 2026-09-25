import { BaseEvent } from '@adonisjs/core/events'

export default class ShipmentReady extends BaseEvent {
  constructor(public orderId: number) {
    super()
  }
}
