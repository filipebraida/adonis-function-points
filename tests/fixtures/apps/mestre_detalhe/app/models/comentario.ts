import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

import Etiqueta from '#models/etiqueta'
import Pedido from '#models/pedido'

/**
 * Also a `hasMany` child of `Pedido` — but `GET /comentarios` addresses it
 * directly, so the user recognises it on its own: its own ILF. This is the
 * control that keeps the rule from being "every child is a RET".
 */
export default class Comentario extends BaseModel {
  static table = 'comentarios'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare pedidoId: number

  @column()
  declare autor: string

  @column()
  declare texto: string

  @belongsTo(() => Pedido)
  declare pedido: BelongsTo<typeof Pedido>

  @hasMany(() => Etiqueta)
  declare etiquetas: HasMany<typeof Etiqueta>
}
