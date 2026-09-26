import { compose } from '@adonisjs/core/helpers'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
// "Bare" specifier: outside the application. The resolver cannot reach it, and
// this is exactly the node_modules boundary that has to be reported.
import { Auditable } from '@acme/auditable'
// the framework's own mixin factory, applied through a LOCAL const: a fact about the
// declaration, not a gap in the walk — what it adds is technical (a hashed password)
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import hash from '@adonisjs/core/services/hash'

import { UserSchema } from '#database/schema'
import Post from '#models/post'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'password',
})

export default class User extends compose(UserSchema, Auditable, AuthFinder) {
  static table = 'users'

  @hasMany(() => Post)
  declare posts: HasMany<typeof Post>
}
