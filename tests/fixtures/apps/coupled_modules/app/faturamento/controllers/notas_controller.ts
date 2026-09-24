import type { HttpContext } from '@adonisjs/core/http'

import Produto from '#catalogo/models/produto'
import Nota from '#faturamento/models/nota'

export default class NotasController {
  async store({ params, response }: HttpContext) {
    const produto = await Produto.findOrFail(params.produtoId)
    await Nota.create({ produtoId: produto.id, total: produto.preco })
    return response.redirect().back()
  }
}
