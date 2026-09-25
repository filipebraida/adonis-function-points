import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Reached by a transaction, so its opaque columns are worth naming. */
export default class Form extends BaseModel {
  static table = 'forms'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  /** the fields a user fills, stored as data: static analysis cannot read them */
  @column()
  declare definition: object

  @column()
  declare filled: Record<string, any> | null
}
