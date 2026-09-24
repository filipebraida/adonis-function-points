import type { HttpContext } from '@adonisjs/core/http'

/**
 * Convenção própria desta aplicação: `repo('<specifier>')` devolve um objeto
 * cujo `gravar()` persiste. Nenhuma estratégia embutida reconhece isso.
 */
declare function repo(specifier: string): { gravar(descricao: string): Promise<unknown> }

export default class ItensController {
  async store({ request, response }: HttpContext) {
    await repo('#repos/item_repo').gravar(request.input('descricao'))
    return response.redirect().back()
  }
}
