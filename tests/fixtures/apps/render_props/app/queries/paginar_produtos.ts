import Produto from '#models/produto'

/**
 * Returns a literal whose `data` is the rows and whose `meta` is pagination: a
 * controller that destructures `{ data, meta }` delivers the rows' store through
 * `data`, and one value through `meta.pagina` — the classified return, not one
 * DET per key.
 */
export default class PaginarProdutos {
  async handle(pagina: number) {
    const rows = await Produto.query().preload('fornecedor').orderBy('nome').limit(20).offset(pagina * 20)

    return {
      data: rows,
      meta: { pagina, porPagina: 20 },
    }
  }
}
