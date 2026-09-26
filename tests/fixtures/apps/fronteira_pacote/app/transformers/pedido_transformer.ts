import { BaseTransformer } from '@adonisjs/core/transformers'

import type Pedido from '#models/pedido'

export default class PedidoTransformer extends BaseTransformer<Pedido> {
  toObject() {
    return {
      id: this.resource.id,
      descricao: this.resource.descricao,
      status: this.resource.status,
      // a call on a column whose type comes from a package: a value derived from the attachment
      capaThumb: this.resource.capa?.variante('thumb'),
    }
  }
}
