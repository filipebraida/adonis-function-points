import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { compose } from '@adonisjs/core/helpers'
import hash from '@adonisjs/core/services/hash'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** the framework's auth mixin: a base from a package — noted, never an unresolved call */
const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'senha',
})

/** read to assign; written as `auth.getUserOrFail()` — the guard's user: an ILF */
export default class Usuario extends compose(BaseModel, AuthFinder) {
  static table = 'usuarios'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string
}
