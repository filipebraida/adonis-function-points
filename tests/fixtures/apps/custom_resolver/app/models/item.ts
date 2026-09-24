import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Item extends BaseModel {
  static table = 'itens'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare descricao: string
}
