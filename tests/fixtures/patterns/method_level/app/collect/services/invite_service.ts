import Invite from '#collect/models/invite'

export default class InviteService {
  /** só lê */
  static async list() {
    return Invite.query().orderBy('id')
  }

  /** escreve */
  static async expire(invite: Invite) {
    invite.expiresAt = null
    await invite.save()
  }
}
