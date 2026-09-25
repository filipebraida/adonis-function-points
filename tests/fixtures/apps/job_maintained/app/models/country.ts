import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Reference data: only the seed writes it, and a route reads it. The CPM puts data
 * maintained by the development team at an EIF at most — never an ILF of this
 * application — and the project-wide maintenance pass used to read the seeder's
 * inserts as the application maintaining the table.
 */
export default class Country extends BaseModel {
  static table = 'countries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare code: string

  @column()
  declare name: string
}
