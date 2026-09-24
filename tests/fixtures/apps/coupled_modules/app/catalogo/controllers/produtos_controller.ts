import type { HttpContext } from '@adonisjs/core/http'

import Produto from '#catalogo/models/produto'

export default class ProdutosController {
  async index({ inertia }: HttpContext) {
    const produtos = await Produto.all()
    return inertia.render('catalogo/produtos', { produtos })
  }
}
