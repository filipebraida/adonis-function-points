import type Livro from '#models/livro'
import { Ficha } from '~/components/ficha'

/** the row goes whole to one child component; the reader follows it one level */
export default function LivroPage({ livro }: { livro: Livro }) {
  return (
    <main>
      <Ficha livro={livro} />
    </main>
  )
}
