import { Head } from '@inertiajs/react'

import type Livro from '#models/livro'

type PageProps = { livros: Livro[] }

/** three of the nine columns are shown: `titulo`, `autor`, `ano` */
export default function LivrosPage({ livros }: PageProps) {
  return (
    <>
      <Head title="Livros" />
      <ul>
        {livros.map((livro) => (
          <li key={livro.id}>
            <strong>{livro.titulo}</strong> — {livro.autor} ({livro.ano})
          </li>
        ))}
      </ul>
    </>
  )
}
