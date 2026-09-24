import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'
import InviteService from '#collect/services/invite_service'

export default class ExpireInviteVerboseController {
  public async handle({ request, response }: HttpContext) {
    /* Busca o convite pelo uuid da rota. */
    const invite = await Invite.findByOrFail(
      'uuid',
      request.param('uuid')
    )

    // Delegates the expiration to the service.
    await InviteService.expire(invite)

    return response.redirect().back()
  }
}
