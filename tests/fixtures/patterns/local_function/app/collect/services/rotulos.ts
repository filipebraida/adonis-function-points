import type Invite from '#collect/models/invite'

/** an IMPORTED function, mapped by reference in the controller */
export function rotuloDe(invite: Invite) {
  return { uuid: invite.uuid, email: invite.email }
}
