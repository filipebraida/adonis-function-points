import { BaseTransformer } from '@adonisjs/core/transformers'

import type Autor from '#models/autor'

/**
 * `pick` lists the fields by name; `id` is the resource's identifier and is not
 * a DET. `totalLivros` is derived and leaves the boundary: 1 DET.
 *
 * Output: `nome`, `totalLivros` — 2 DETs.
 */
export default class AutorTransformer extends BaseTransformer<Autor> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'nome']),
      totalLivros: this.resource.livros?.length ?? 0,
    }
  }
}
