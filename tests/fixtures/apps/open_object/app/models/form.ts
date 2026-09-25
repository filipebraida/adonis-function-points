import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Form extends BaseModel {
  static table = 'forms'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare answers: any

  /** A second opaque column: the override names ONE schema, so only one is replaced. */
  @column()
  declare snapshot: any
}
