import { BaseTransformer } from '@adonisjs/core/transformers'

import type Livro from '#models/livro'

/**
 * A spread the analysis cannot read: `serialize()` comes from Lucid and emits
 * whatever the model has. It counts 1 DET as a floor and is reported — never
 * zero, never guessed. `formato` is 1.
 *
 * Output: 2 DETs, one of them opaque.
 */
export default class ExportacaoTransformer extends BaseTransformer<Livro> {
  toObject() {
    return {
      ...this.resource.serialize(),
      formato: 'csv',
    }
  }
}
