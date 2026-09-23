import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'

import Book from '#admin/catalog/models/book'

export default class Author extends BaseModel {
  static table = 'authors'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare country: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @hasMany(() => Book)
  declare books: HasMany<typeof Book>
}
