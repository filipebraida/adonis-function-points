import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'

/** lookups pre-computed elsewhere and handed in through the constructor, one level down a named type */
type Extras = {
  panel: Map<number, { seen: boolean }>
  labels: Set<string>
}

export default class LookupsController {
  constructor(protected extras?: Extras) {}

  public async handle({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    const panel = this.extras?.panel?.get(invite.id)
    const flagged = this.extras?.labels.has(invite.email)
    return response.json({ panel, flagged })
  }
}
