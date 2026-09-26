import { BaseTransformer } from '@adonisjs/core/transformers'

import type Produto from '#models/produto'

/** 3 keys; `id` is the resource's identifier */
export default class ProdutoTransformer extends BaseTransformer<Produto> {
  toObject() {
    return {
      id: this.resource.id,
      nome: this.resource.nome,
      preco: this.resource.preco,
      categoria: this.resource.categoria,
    }
  }
}
