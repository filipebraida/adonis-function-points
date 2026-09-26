import type Livro from '#models/livro'
import { Capa } from '~/components/capa'

export function Vitrine({ livros }: { livros: Livro[] }) {
  return (
    <section>
      {livros.map((livro) => (
        <Capa key={livro.id} livro={livro} />
      ))}
    </section>
  )
}
