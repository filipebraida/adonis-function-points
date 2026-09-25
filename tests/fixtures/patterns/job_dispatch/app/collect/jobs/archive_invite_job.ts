import Invite from '#collect/models/invite'

/**
 * `dispatch` comes from the queue package's base class, and the method that
 * runs is `process` — the shape `@nemoventures/adonis-jobs` uses. Looking only
 * for `handle` resolved this file, found no body, reported the dispatch as an
 * unknown, and left the write below uncounted.
 */
export default class ArchiveInviteJob {
  declare data: { inviteId: number }

  async process() {
    const invite = await Invite.findOrFail(this.data.inviteId)
    invite.expiresAt = null
    await invite.save()
  }
}
