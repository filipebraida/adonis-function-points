import Produto from '#models/produto'

export const CATEGORIAS = { livros: 'livros', jogos: 'jogos' } as const

/**
 * Its helpers are functions of THIS file, not imports: `proximos` reads the
 * store, `paraCard` shapes a row and is mapped BY REFERENCE (`lista.map(paraCard)`).
 * The meta is Lucid's own (`paginator.getMeta()`); `porCategoria` is a map keyed
 * by an enum — one repeating attribute, however many keys.
 */
export default class ListarRelacionados {
  async handle(id: string, categoria: string | null) {
    const paginator = await proximos(id, categoria)
    const lista = paginator.all()

    return {
      itens: lista.map(paraCard),
      meta: paginator.getMeta(),
      porCategoria: {
        [CATEGORIAS.livros]: lista.filter((p) => p.categoria === 'livros').length,
        [CATEGORIAS.jogos]: lista.filter((p) => p.categoria === 'jogos').length,
      },
    }
  }
}

/** a local function reading the store: Produto and, through the preload, Fornecedor */
async function proximos(id: string, categoria: string | null) {
  const query = Produto.query().whereNot('id', id).preload('fornecedor').orderBy('nome')
  if (categoria) query.where('categoria', categoria)
  return query.paginate(1, 3)
}

/** a local function shaping a row: three leaves, not the columns */
function paraCard(produto: Produto) {
  return {
    nome: produto.nome,
    preco: produto.preco,
    fornecedor: produto.fornecedor?.nome ?? null,
  }
}
