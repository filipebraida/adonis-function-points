import Invite from '#collect/models/invite'

export async function expireInvite(invite: Invite) {
  invite.expiresAt = null
  await invite.save()
}
