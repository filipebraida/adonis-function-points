import Invite from '#collect/models/invite'

export default class InviteService {
  /** a property holding a function: NOT a method of the class */
  private audit = (message: string) => message.trim()

  async expire(uuid: string) {
    const invite = await this.findByUuid(uuid)
    await this.persistExpiration(invite)
    this.audit('expired')
  }

  private async findByUuid(uuid: string) {
    return Invite.findByOrFail('uuid', uuid)
  }

  /** the write is here, reachable only through `this.` */
  private async persistExpiration(invite: Invite) {
    invite.expiresAt = null
    await invite.save()
  }
}
