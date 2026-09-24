import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Nota extends BaseModel {
  static table = 'notas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare produtoId: number

  @column()
  declare total: number
}
