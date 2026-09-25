import type OrderPlaced from '#events/order_placed'
import StockMovement from '#models/stock_movement'

export default class ReserveStock {
  async handle(event: OrderPlaced) {
    await StockMovement.create({ orderId: event.orderId, quantity: 1 })
  }
}
