import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'

import InviteService from '#collect/services/invite_service'

@inject()
export default class ExpireInviteController {
  constructor(private invites: InviteService) {}

  public async handle({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    await this.invites.expire(invite)
    return response.redirect().back()
  }
}
