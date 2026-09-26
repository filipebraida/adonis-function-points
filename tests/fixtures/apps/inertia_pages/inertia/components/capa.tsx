import type Livro from '#models/livro'

/** the reader never gets here: two levels down from the page */
export function Capa({ livro }: { livro: Livro }) {
  return <img src={livro.capaUrl} alt={livro.titulo} />
}
