import { BaseModel, column, manyToMany } from '@adonisjs/lucid/orm'
import type { ManyToMany } from '@adonisjs/lucid/types/relations'

import Usuario from '#models/usuario'

/** five columns; every transaction of this fixture reaches it through the raw query builder, never through the model */
export default class Pedido extends BaseModel {
  static table = 'pedidos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare descricao: string

  @column()
  declare status: string

  @column()
  declare valor: number

  @column()
  declare responsavelId: number | null

  @column()
  declare prazo: string

  @manyToMany(() => Usuario, { pivotTable: 'pedido_usuario' })
  declare envolvidos: ManyToMany<typeof Usuario>
}
