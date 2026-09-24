import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'
import InviteService from '#collect/services/invite_service'

export default class ExpireInviteController {
  public async handle({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    await InviteService.expire(invite)
    return response.redirect().back()
  }
}
