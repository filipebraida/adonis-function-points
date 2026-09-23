import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'

export default class ExpireInviteController {
  public async handle({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    invite.expiresAt = null
    await invite.save()
    return response.redirect().back()
  }
}
