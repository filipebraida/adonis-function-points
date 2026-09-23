import { column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

import BaseModel from '#models/base_model'
import Post from '#models/post'

export default class User extends BaseModel {
  static table = 'users'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare email: string

  @column()
  declare fullName: string | null

  @hasMany(() => Post)
  declare posts: HasMany<typeof Post>
}
