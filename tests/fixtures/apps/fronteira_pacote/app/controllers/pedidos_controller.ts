import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'

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

  async store({ request, response }: HttpContext) {
    await Pedido.create({ descricao: request.input('descricao'), status: 'aberto' })
    return response.created({})
  }
}
