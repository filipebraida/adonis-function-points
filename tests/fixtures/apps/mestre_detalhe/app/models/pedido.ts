import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import type { DateTime } from 'luxon'

import Comentario from '#models/comentario'
import Etiqueta from '#models/etiqueta'
import ItemPedido from '#models/item_pedido'

/** the master: 5 user-recognisable columns, one system timestamp */
export default class Pedido extends BaseModel {
  static table = 'pedidos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare cliente: string

  @column()
  declare status: string

  @column()
  declare total: number

  @column()
  declare observacao: string | null

  @column.dateTime()
  declare emitidoEm: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @hasMany(() => ItemPedido)
  declare itens: HasMany<typeof ItemPedido>

  @hasMany(() => Comentario)
  declare comentarios: HasMany<typeof Comentario>

  @hasMany(() => Etiqueta)
  declare etiquetas: HasMany<typeof Etiqueta>
}
