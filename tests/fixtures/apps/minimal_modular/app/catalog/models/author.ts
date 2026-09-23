import { AuthorSchema } from '#core/database/schema'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Book from '#catalog/models/book'

export default class Author extends AuthorSchema {
  static table = 'authors'

  @hasMany(() => Book)
  declare books: HasMany<typeof Book>
}
