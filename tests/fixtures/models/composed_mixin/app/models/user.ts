import { compose } from '@adonisjs/core/helpers'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
// "Bare" specifier: outside the application. The resolver cannot reach it, and
// this is exactly the node_modules boundary that has to be reported.
import { Auditable } from '@acme/auditable'

import { UserSchema } from '#database/schema'
import Post from '#models/post'

export default class User extends compose(UserSchema, Auditable) {
  static table = 'users'

  @hasMany(() => Post)
  declare posts: HasMany<typeof Post>
}
