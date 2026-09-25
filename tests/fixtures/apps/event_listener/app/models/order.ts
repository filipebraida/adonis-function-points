import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Order extends BaseModel {
  static table = 'orders'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare reference: string

  @column()
  declare total: number
}
