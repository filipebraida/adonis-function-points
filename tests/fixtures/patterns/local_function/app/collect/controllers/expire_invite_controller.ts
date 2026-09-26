import type { HttpContext } from '@adonisjs/core/http'

import Invite from '#collect/models/invite'
import { rotuloDe } from '#collect/services/rotulos'

export default class ExpireInviteController {
  public async handle({ request, response }: HttpContext) {
    const invite = await buscar(request.param('uuid'))
    await expirar(invite)
    const outros = await Invite.query().whereNot('id', invite.id)

    return response.json({
      atual: paraTela(invite),
      outros: outros.map(rotuloDe),
      // declared INSIDE the body: part of it, walked with it — not a resolver's business
      pendentes: outros.filter(pendente).length,
    })

    function pendente(i: Invite) {
      return !i.expiredAt
    }
  }
}

/** a function declaration of the file */
async function buscar(uuid: string) {
  return Invite.findByOrFail('uuid', uuid)
}

/** an arrow bound at module level: a function by another declaration */
const expirar = async (invite: Invite) => {
  invite.expiredAt = new Date()
  await invite.save()
}

function paraTela(invite: Invite) {
  return { uuid: invite.uuid, expirado: !!invite.expiredAt }
}
