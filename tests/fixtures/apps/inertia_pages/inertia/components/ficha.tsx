import type Livro from '#models/livro'

/** shows two columns of the row it received */
export function Ficha({ livro }: { livro: Livro }) {
  return (
    <dl>
      <dt>Título</dt>
      <dd>{livro.titulo}</dd>
      <dt>ISBN</dt>
      <dd>{livro.isbn}</dd>
    </dl>
  )
}
