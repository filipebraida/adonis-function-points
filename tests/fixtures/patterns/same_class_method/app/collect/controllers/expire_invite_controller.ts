import type { HttpContext } from '@adonisjs/core/http'

import InviteService from '#collect/services/invite_service'
import InviteMailer from '#collect/services/vendor_backed'

export default class ExpireInviteController {
  public async handle({ request, response }: HttpContext) {
    await new InviteService().expire(request.param('uuid'))

    // `sendLater` is inherited from a package class: it is not in this project
    InviteMailer.sendLater({})

    return response.redirect().back()
  }
}
