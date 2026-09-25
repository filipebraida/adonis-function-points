import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Report extends BaseModel {
  static table = 'reports'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare total: number
}
