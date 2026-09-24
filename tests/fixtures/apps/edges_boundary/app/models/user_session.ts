import { BaseModel, column } from '@adonisjs/lucid/orm'

/** `.*session.*` é padrão de dado temporário no AFP §6.5.2.1.3. */
export default class UserSession extends BaseModel {
  static table = 'user_sessions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare token: string
}
