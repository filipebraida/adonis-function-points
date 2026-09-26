import type Produto from '#models/produto'

/** builds a document; what it puts in the columns is not readable as DETs */
export function gerarCsv(produtos: Produto[]): string {
  return produtos.map((p) => `${p.nome};${p.preco}`).join('\n')
}

/** a fixed text: nothing the analysis can read flows into it */
export function gerarManifesto(): string {
  return 'Catálogo de produtos — manifesto'
}
