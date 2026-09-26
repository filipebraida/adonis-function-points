import { BaseTransformer } from '@adonisjs/core/transformers'

import type Livro from '#models/livro'

/**
 * Consumes the preloaded author to emit ONE derived key. The author's table does
 * not leave: it was loaded for the transformer, and the transformer says what
 * leaves for what it was loaded with.
 *
 * Output: `titulo`, `autorNome` — 2 DETs.
 */
export default class RecenteTransformer extends BaseTransformer<Livro> {
  toObject() {
    return {
      titulo: this.resource.titulo,
      autorNome: this.resource.autor?.nome ?? null,
    }
  }
}
