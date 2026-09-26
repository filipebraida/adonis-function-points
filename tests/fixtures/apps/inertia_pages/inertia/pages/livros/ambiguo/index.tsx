import type Livro from '#models/livro'

/** a second file answers to `livros/ambiguo`: the reader must not pick one */
export default function AmbiguoIndexPage({ livros }: { livros: Livro[] }) {
  return <p>{livros.length}</p>
}
