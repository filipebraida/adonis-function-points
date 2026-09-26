import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'
import InviteTransformer from '#collect/transformers/invite_transformer'
import LocalFormatter from '#collect/transformers/local_formatter'

export default class ExpireInviteController {
  public async handle({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    return response.json(InviteTransformer.transform(invite))
  }

  /** the variant is where this page's fields are */
  public async resumo({ request, response }: HttpContext) {
    const invite = await Invite.findByOrFail('uuid', request.param('uuid'))
    return response.json(InviteTransformer.transform(invite).useVariant('forResumo'))
  }

  /** The control: a `transform` that belongs to the application, not a package. */
  public async format({ request }: HttpContext) {
    const formatter = new LocalFormatter()
    return formatter.transform(request.param('value'))
  }
}
