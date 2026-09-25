import { BaseTransformer } from '@adonisjs/core/transformers'

import type Livro from '#models/livro'
import AutorTransformer from '#transformers/autor_transformer'

/**
 * Output of `toObject()`: `titulo`, `isbn`, and the two keys of the nested
 * `AutorTransformer` — 4 DETs. `id` is the identifier and is not one.
 *
 * `forDetalhe()` spreads `toObject()` and adds `resumo` and `paginas`: 6 DETs.
 */
export default class LivroTransformer extends BaseTransformer<Livro> {
  toObject() {
    const livro = this.resource

    return {
      id: livro.id,
      titulo: livro.titulo,
      isbn: livro.isbn,
      autor: AutorTransformer.transform(livro.autor),
    }
  }

  forDetalhe() {
    const livro = this.resource

    return {
      ...this.toObject(),
      resumo: livro.resumo,
      paginas: livro.paginas,
    }
  }
}
