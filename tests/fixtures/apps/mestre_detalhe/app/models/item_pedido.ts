import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import Pedido from '#models/pedido'

/**
 * The detail. Nothing in the application addresses it directly — it is only
 * ever reached through `pedido.related('itens')` and `preload('itens')` — so
 * the user never sees a line outside its order: a RET of `Pedido`.
 */
export default class ItemPedido extends BaseModel {
  static table = 'itens_pedido'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare pedidoId: number

  @column()
  declare produto: string

  @column()
  declare quantidade: number

  @column()
  declare preco: number

  @belongsTo(() => Pedido)
  declare pedido: BelongsTo<typeof Pedido>
}
