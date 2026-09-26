import { BaseModel, column } from '@adonisjs/lucid/orm'

/** written by the POST, deleted by the DELETE: an ILF */
export default class Pedido extends BaseModel {
  static table = 'pedidos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare descricao: string

  @column()
  declare status: string
}
