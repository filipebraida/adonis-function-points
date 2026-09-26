import Produto from '#models/produto'

/** a query object: what it READS is what its result delivers — Produto and, through the preload, Fornecedor */
export default class ListarProdutos {
  async handle(busca: string | null) {
    const query = Produto.query().preload('fornecedor').orderBy('nome')
    if (busca) query.whereILike('nome', `%${busca}%`)
    return query
  }
}
