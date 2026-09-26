import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Written by the application and reached by a route, and still not a data
 * function: a token is the machinery of authentication, not something the user
 * maintains. `@adonisjs/auth` ships `auth_access_tokens` and
 * `remember_me_tokens` in the same shape.
 */
export default class PasswordResetToken extends BaseModel {
  static table = 'password_reset_tokens'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare email: string

  @column()
  declare token: string
}
