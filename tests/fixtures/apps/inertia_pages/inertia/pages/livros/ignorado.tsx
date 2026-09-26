import type Livro from '#models/livro'

/** receives the rows and shows none of them: the reader sees nothing using `livros` */
export default function IgnoradoPage({ livros }: { livros: Livro[] }) {
  void livros
  return <h1>Acervo</h1>
}
