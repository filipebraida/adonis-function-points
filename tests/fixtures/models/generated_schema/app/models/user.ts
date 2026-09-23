import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

import { UserSchema } from '#database/schema'
import Post from '#models/post'

export default class User extends UserSchema {
  static table = 'users'

  @hasMany(() => Post)
  declare posts: HasMany<typeof Post>
}
