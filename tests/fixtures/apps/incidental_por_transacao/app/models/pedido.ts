import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Pedido extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare descricao: string

  @column()
  declare status: string
}
