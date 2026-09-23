import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'

import { expireInvite } from '#collect/services/expire_invite'

export default class ExpireInviteController {
  public async handle({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    await expireInvite(invite)
    return response.redirect().back()
  }
}
