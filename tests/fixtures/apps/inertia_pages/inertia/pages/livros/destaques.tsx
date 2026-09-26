import type Livro from '#models/livro'
import { Vitrine } from '~/components/vitrine'

/** the rows go to a component that hands each one to another: two levels */
export default function DestaquesPage({ livros }: { livros: Livro[] }) {
  return <Vitrine livros={livros} />
}
