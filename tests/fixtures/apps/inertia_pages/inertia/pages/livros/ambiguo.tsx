import type Livro from '#models/livro'

export default function AmbiguoPage({ livros }: { livros: Livro[] }) {
  return <p>{livros.length}</p>
}
