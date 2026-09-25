import type { HttpContext } from '@adonisjs/core/http'

import AuditClient from '#repos/audit_client'

/**
 * This application's own convention: `repo('<specifier>')` returns an object
 * whose `gravar()` persists. No built-in strategy recognises it.
 */
declare function repo(specifier: string): { gravar(descricao: string): Promise<unknown> }

export default class ItensController {
  private audit = new AuditClient()

  async store({ request, response }: HttpContext) {
    await repo('#repos/item_repo').gravar(request.input('descricao'))
    await this.audit.push('itens.store')
    return response.redirect().back()
  }
}
