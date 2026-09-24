import Invite from '#collect/models/invite'

export default class InviteService {
  /** propriedade que guarda função: NÃO é método da classe */
  private audit = (message: string) => message.trim()

  async expire(uuid: string) {
    const invite = await this.findByUuid(uuid)
    await this.persistExpiration(invite)
    this.audit('expired')
  }

  private async findByUuid(uuid: string) {
    return Invite.findByOrFail('uuid', uuid)
  }

  /** a escrita está aqui, alcançável só por `this.` */
  private async persistExpiration(invite: Invite) {
    invite.expiresAt = null
    await invite.save()
  }
}
