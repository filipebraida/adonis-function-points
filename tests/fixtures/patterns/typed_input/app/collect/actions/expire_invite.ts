import { DateTime } from 'luxon'

// import de TIPO: o model nunca é usado como valor aqui
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
