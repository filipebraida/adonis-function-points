import type { HttpContext } from '@adonisjs/core/http'

import ShipmentReady from '#events/shipment_ready'
import { events } from '#generated/events'
import Order from '#models/order'

export default class OrdersController {
  async store({ request, response }: HttpContext) {
    const order = await Order.create({ reference: request.input('reference'), total: 0 })

    /** the user clicks, and the effect happens in a listener */
    await events.OrderPlaced.dispatch(order.id)

    return response.created(order)
  }

  async ship({ params, response }: HttpContext) {
    /** the direct form: `Identifier.dispatch(args)`, which `job-dispatch` also matches */
    await ShipmentReady.dispatch(Number(params.id))

    return response.noContent()
  }
}
