import type { HttpContext } from '@adonisjs/core/http'

import InviteService from '#collect/services/invite_service'
import InviteTransformer from '#collect/services/vendor_backed'

export default class ExpireInviteController {
  public async handle({ request, response }: HttpContext) {
    await new InviteService().expire(request.param('uuid'))

    // `transform` é herdado de classe de pacote: não existe neste projeto
    InviteTransformer.transform({})

    return response.redirect().back()
  }
}
