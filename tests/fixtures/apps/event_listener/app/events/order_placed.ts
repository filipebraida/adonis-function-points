import { BaseEvent } from '@adonisjs/core/events'

/** `dispatch` comes from `BaseEvent`: this class declares no body to follow. */
export default class OrderPlaced extends BaseEvent {
  constructor(public orderId: number) {
    super()
  }
}
