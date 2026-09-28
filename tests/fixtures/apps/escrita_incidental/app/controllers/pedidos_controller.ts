import type { HttpContext } from '@adonisjs/core/http'

import { garantirCatalogo } from '#actions/garantir_catalogo'
import { registrarVisita } from '#actions/registrar_visita'
import Categoria from '#models/categoria'
import Conta from '#models/conta'
import Pedido from '#models/pedido'

export default class PedidosController {
  /** shows the order — and counts the visit on the way */
  async show({ params, response }: HttpContext) {
    const pedido = await Pedido.findOrFail(params.id)
    await registrarVisita(pedido)
    return response.json({ descricao: pedido.descricao, status: pedido.status })
  }

  /** shows the catalogue — and creates the default one on first read */
  async catalogo({ response }: HttpContext) {
    await garantirCatalogo()
    const categorias = await Categoria.query().select('nome')
    return response.json(categorias)
  }

  /** the provider sends the user back here: linking the account IS the point */
  async callback({ request, response }: HttpContext) {
    await Conta.updateOrCreate(
      { provedor: 'externo', externoId: request.input('codigo') },
      { provedor: 'externo', externoId: request.input('codigo') }
    )
    return response.redirect('/pedidos')
  }

  async store({ request, response }: HttpContext) {
    await Pedido.create({ descricao: request.input('descricao'), status: 'aberto', visualizacoes: 0 })
    return response.redirect('/pedidos')
  }
}
