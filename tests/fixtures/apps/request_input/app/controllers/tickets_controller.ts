import type { HttpContext } from '@adonisjs/core/http'

import Ticket from '#models/ticket'

export default class TicketsController {
  /**
   * Four fields cross the boundary and no validator declares them. Counted from
   * the route parameters alone this sat at 1 DET — the floor of its band — while
   * §7.2 asks whether a user-recognisable field crosses, not how it was declared.
   */
  async store({ request, response }: HttpContext) {
    const ticket = await Ticket.create({
      subject: request.input('subject'),
      body: request.input('body'),
      ...request.only(['priority', 'channel']),
    })

    return response.created(ticket)
  }

  /**
   * The control: a workflow trigger. It never touches the request, so there is
   * nothing to declare and nothing to warn about — the distinction two earlier
   * versions of the warning got wrong.
   */
  async close({ params, response }: HttpContext) {
    const ticket = await Ticket.findOrFail(params.id)
    ticket.closedAt = 'now'
    await ticket.save()

    return response.noContent()
  }

  /** Enumerates nothing: whatever arrives is read. This is the honest blind spot. */
  async bulk({ request, response }: HttpContext) {
    await Ticket.create(request.all())

    return response.created({})
  }
}
