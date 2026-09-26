import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'

import { guias } from '#collections/guias'
import Pedido from '#models/pedido'
import Usuario from '#models/usuario'
import Permissoes from '#services/permissoes'
import Relatorios from '#services/relatorios'
import PedidoTransformer from '#transformers/pedido_transformer'

@inject()
export default class PedidosController {
  constructor(
    private permissoes: Permissoes,
    private relatorios: Relatorios
  ) {}

  /** authorisation through a package, content through a package, a variant of an attachment through a package */
  async index({ auth, inertia }: HttpContext) {
    const usuario = await Usuario.findOrFail(auth.user!.id)
    const podeEditar = await this.permissoes.pode(usuario, 'pedidos.editar')
    const pedidos = await Pedido.query().orderBy('descricao')
    const ajuda = await guias.carregar('pedidos')

    return inertia.render('pedidos/index', {
      pedidos: PedidoTransformer.transform(pedidos),
      podeEditar,
      ajuda,
    })
  }

  /** the control: a service of the application whose body cannot be found — a gap, and it stays one */
  async resumo({ response }: HttpContext) {
    const pedidos = await Pedido.query().where('status', 'aberto')
    const texto = await this.relatorios.resumo(pedidos)
    return response.send(texto)
  }

  /** a static page: reaches no store, and is not a transaction — listed, not counted */
  async sobre({ inertia }: HttpContext) {
    return inertia.render('sobre', {})
  }

  /** the raw query builder: a data access the analysis does not read yet — listed with a mark (plan 0.12 §A), read in §B */
  async contagem({ response }: HttpContext) {
    const [{ total }] = await db.from('pedidos').where('status', 'aberto').count('* as total')
    return response.json({ total })
  }

  async store({ request, response }: HttpContext) {
    await Pedido.create({ descricao: request.input('descricao'), status: 'aberto' })
    return response.created({})
  }
}
