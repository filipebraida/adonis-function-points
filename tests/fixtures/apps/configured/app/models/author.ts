import { AuthorSchema } from '#database/schema'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Book from '#models/book'

export default class Author extends AuthorSchema {
  static table = 'authors'

  @hasMany(() => Book)
  declare books: HasMany<typeof Book>
}
