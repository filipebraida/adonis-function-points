import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'

import { archiveInvite as archive } from '#collect/services/archive_invite'
import { expireInvite } from '#collect/services/expire_invite'

export default class ExpireInviteController {
  public async handle({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    await expireInvite(invite)

    /**
     * Imported under a different local name. The body carries the EXPORTED
     * name, so following `archive` looks for a function that does not exist.
     */
    await archive(invite)

    return response.redirect().back()
  }
}
