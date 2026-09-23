import { BookSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Author from '#models/author'

export default class Book extends BookSchema {
  static table = 'books'

  @belongsTo(() => Author)
  declare author: BelongsTo<typeof Author>
}
