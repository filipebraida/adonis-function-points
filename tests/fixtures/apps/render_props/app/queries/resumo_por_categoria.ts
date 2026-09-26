import Produto from '#models/produto'

/**
 * A query object that RETURNS A LITERAL: what leaves is the literal's leaves —
 * `categorias.rotulo` and `categorias.total`, once (a repeating group, §7) —
 * not the columns of `Produto`.
 */
export default class ResumoPorCategoria {
  async handle() {
    const linhas = await Produto.query().select('categoria').count('* as total').groupBy('categoria')

    return {
      categorias: linhas.map((linha) => ({ rotulo: linha.categoria, total: Number(linha.$extras.total) })),
    }
  }
}
