import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'

import ArchiveInviteJob from '#collect/jobs/archive_invite_job'
import ExpireInviteJob from '#collect/jobs/expire_invite_job'

export default class ExpireInviteController {
  public async handle({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    await ExpireInviteJob.dispatch({ inviteId: invite.id })
    await ArchiveInviteJob.dispatch({ inviteId: invite.id })
    return response.redirect().back()
  }
}
