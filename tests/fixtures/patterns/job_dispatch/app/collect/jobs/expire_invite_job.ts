import Invite from '#collect/models/invite'

export default class ExpireInviteJob {
  static async dispatch({ inviteId }: { inviteId: number }) {
    const invite = await Invite.findOrFail(inviteId)
    invite.expiresAt = null
    await invite.save()
  }
}
