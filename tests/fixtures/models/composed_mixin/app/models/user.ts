import { compose } from '@adonisjs/core/helpers'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
// Specifier "bare": fora da aplicação. O resolvedor não alcança, e é
// exatamente a fronteira de node_modules que precisa ser reportada.
import { Auditable } from '@acme/auditable'

import { UserSchema } from '#database/schema'
import Post from '#models/post'

export default class User extends compose(UserSchema, Auditable) {
  static table = 'users'

  @hasMany(() => Post)
  declare posts: HasMany<typeof Post>
}
