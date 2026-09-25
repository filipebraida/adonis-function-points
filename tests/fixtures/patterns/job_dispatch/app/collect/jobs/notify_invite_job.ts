import Invite from '#collect/models/invite'

/**
 * `@adonisjs/queue` — the official package — generates `async execute()` in its
 * own `make:job` stub. It was the third name this list had to learn, and it only
 * surfaced once event dispatch started being followed: the listener was what
 * enqueued the job, so that path had never been walked.
 */
export default class NotifyInviteJob {
  declare payload: { inviteId: number }

  async execute() {
    const invite = await Invite.findOrFail(this.payload.inviteId)
    invite.uuid = 'notified'
    await invite.save()
  }
}
