import Invite from '#collect/models/invite'

export default class ExpireInvite {
  async handle({ invite }: { invite: Invite }) {
    invite.expiresAt = null
    await invite.save()
  }
}
