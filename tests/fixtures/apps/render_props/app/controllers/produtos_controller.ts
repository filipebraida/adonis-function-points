import type { HttpContext } from '@adonisjs/core/http'

import Fornecedor from '#models/fornecedor'
import Produto from '#models/produto'
import Usuario from '#models/usuario'
import ListarProdutos from '#queries/listar_produtos'
import ResumoPorCategoria from '#queries/resumo_por_categoria'
import ProdutoTransformer from '#transformers/produto_transformer'
import { criarProdutoValidator } from '#validators/produto'
import { gerarCsv } from '#queries/csv'

export default class ProdutosController {
  /**
   * The collection comes out of a query object: it delivers what that body reads
   * (Produto and Fornecedor). `total` is a derived scalar. `filtros` echoes two
   * fields that entered as input: a DET that enters and exits counts once (§7.3).
   */
  async index({ request, inertia }: HttpContext) {
    const busca = request.input('busca')
    const ativo = request.input('ativo')
    const produtos = await new ListarProdutos().handle(busca)

    return inertia.render('produtos/index', {
      produtos,
      total: produtos.length,
      filtros: { busca, ativo },
    })
  }

  /** `Usuario` is read to authorise and never delivered: an FTR, no output DET */
  async show({ params, auth, inertia, response }: HttpContext) {
    const usuario = await Usuario.findOrFail(auth.user!.id)
    if (usuario.papel === 'bloqueado') return response.forbidden()

    const produto = await Produto.findOrFail(params.id)

    return inertia.render('produtos/show', {
      produto,
      podeEditar: usuario.papel === 'admin',
    })
  }

  /** props by identifier, resolving to a query object that returns a literal */
  async resumo({ inertia }: HttpContext) {
    const resumo = await new ResumoPorCategoria().handle()
    return inertia.render('produtos/resumo', resumo)
  }

  /** a document the analysis cannot read: 1 DET as a floor, reported */
  async exportar({ response }: HttpContext) {
    const produtos = await Produto.query().orderBy('nome')
    response.header('content-type', 'text/csv')
    return response.send(gerarCsv(produtos))
  }

  /** `inertia.modal` is `render` by another name; the mapped list contributes its leaves once */
  async editar({ params, inertia }: HttpContext) {
    const produto = await Produto.findOrFail(params.id)
    const fornecedores = await Fornecedor.query().orderBy('nome')

    return inertia.modal('produtos/form', {
      produto: ProdutoTransformer.transform(produto),
      fornecedores: fornecedores.map((f) => ({ id: f.id, nome: f.nome })),
    })
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(criarProdutoValidator)
    await Produto.create({ ...payload, estoque: 0 })
    return response.redirect().toRoute('produtos.index')
  }
}
