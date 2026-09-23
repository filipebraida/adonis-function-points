import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'

import Author from '#admin/catalog/models/author'

export default class Book extends BaseModel {
  static table = 'books'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare authorId: number

  @column()
  declare title: string

  @column()
  declare isbn: string | null

  @column()
  declare publishedYear: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Author)
  declare author: BelongsTo<typeof Author>
}
