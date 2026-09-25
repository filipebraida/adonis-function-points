import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import Comentario from '#models/comentario'
import Pedido from '#models/pedido'

/**
 * Never addressed directly, but a `hasMany` child of TWO parents. Which one it
 * belongs to is not derivable from the code, so it stays its own data function
 * and the count says why. Never written: an EIF.
 */
export default class Etiqueta extends BaseModel {
  static table = 'etiquetas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare pedidoId: number | null

  @column()
  declare comentarioId: number | null

  @belongsTo(() => Pedido)
  declare pedido: BelongsTo<typeof Pedido>

  @belongsTo(() => Comentario)
  declare comentario: BelongsTo<typeof Comentario>
}
