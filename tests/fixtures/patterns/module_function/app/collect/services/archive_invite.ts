import Invite from '#collect/models/invite'

export async function archiveInvite(invite: Invite) {
  invite.expiresAt = null
  await invite.save()
}
