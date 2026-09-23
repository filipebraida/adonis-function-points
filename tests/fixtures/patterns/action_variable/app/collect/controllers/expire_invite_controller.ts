import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'

import ExpireInvite from '#collect/actions/expire_invite'

export default class ExpireInviteController {
  public async handle({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    const expire = new ExpireInvite()
    await expire.handle({ invite })
    return response.redirect().back()
  }
}
