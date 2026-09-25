import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Form extends BaseModel {
  static table = 'forms'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare answers: any
}
