import { BaseTransformer } from '@adonisjs/core/transformers'

import type Tarefa from '#models/tarefa'

/** emits a system timestamp on purpose: it is still not a DET */
export default class TarefaTransformer extends BaseTransformer<Tarefa> {
  toObject() {
    return {
      titulo: this.resource.titulo,
      createdAt: this.resource.createdAt,
    }
  }
}
