import type { HttpContext } from '@adonisjs/core/http'

import InviteService from '#collect/services/invite_service'

export default class ListInvitesController {
  public async handle({ inertia }: HttpContext) {
    const invites = await InviteService.list()
    return inertia.render('invites/index', { invites })
  }
}
