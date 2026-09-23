import Invite from '#collect/models/invite'

export default class InviteService {
  static async expire(invite: Invite) {
    invite.expiresAt = null
    await invite.save()
  }
}
