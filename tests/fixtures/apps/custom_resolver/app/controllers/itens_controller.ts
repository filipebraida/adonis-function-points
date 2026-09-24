import type { HttpContext } from '@adonisjs/core/http'

/**
 * This application's own convention: `repo('<specifier>')` returns an object
 * whose `gravar()` persists. No built-in strategy recognises it.
 */
declare function repo(specifier: string): { gravar(descricao: string): Promise<unknown> }

export default class ItensController {
  async store({ request, response }: HttpContext) {
    await repo('#repos/item_repo').gravar(request.input('descricao'))
    return response.redirect().back()
  }
}
