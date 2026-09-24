import { DateTime } from 'luxon'

// TYPE import: the model is never used as a value here
import type Invite from '#collect/models/invite'

export interface ExpireInviteInput {
  invite: Invite
}

export default class ExpireInvite {
  async handle(input: ExpireInviteInput): Promise<Invite> {
    input.invite.expiresAt = DateTime.now()

    await input.invite.save()

    return input.invite
  }
}
