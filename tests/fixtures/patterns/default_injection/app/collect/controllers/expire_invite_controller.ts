import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'

import InviteService from '#collect/services/invite_service'

/**
 * Injection without the container: a constructor parameter property whose
 * dependency comes from a default value.
 *
 * There is NO type annotation — the type is inferred from the initialiser — so
 * reading `getTypeNode()` sees nothing. The class name is right there in
 * `new InviteService()`, which is the same shape `action-object` already reads.
 */
export default class ExpireInviteController {
  constructor(private invites = new InviteService()) {}

  public async handle({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    await this.invites.expire(invite)
    return response.redirect().back()
  }
}
