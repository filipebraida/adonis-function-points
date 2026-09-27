import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

import Pedido from '#models/pedido'

export default class PedidosController {
  async index({ response }: HttpContext) {
    return response.json(await Pedido.query().select('descricao', 'status'))
  }

  async store({ request, response }: HttpContext) {
    await Pedido.create({ descricao: request.input('descricao'), status: 'aberto' })
    return response.redirect('/pedidos')
  }

  /** `registros` has no model: only the generated schema knows its columns */
  async registros({ response }: HttpContext) {
    return response.json(await db.from('registros').select('acao', 'autor', 'detalhe'))
  }

  async resumo({ response }: HttpContext) {
    const linhas = await db
      .from('pedidos')
      .join('registros', 'registros.pedido_id', 'pedidos.id')
      .select('pedidos.status', 'registros.acao')
    return response.json(linhas)
  }

  async anotar({ request, response }: HttpContext) {
    await db.table('registros').insert({
      pedido_id: request.input('pedidoId'),
      acao: request.input('acao'),
      autor: 'sistema',
    })
    return response.redirect('/painel/registros')
  }
}
