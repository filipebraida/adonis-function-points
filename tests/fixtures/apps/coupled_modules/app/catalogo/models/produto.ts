import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Produto extends BaseModel {
  static table = 'produtos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare preco: number
}
