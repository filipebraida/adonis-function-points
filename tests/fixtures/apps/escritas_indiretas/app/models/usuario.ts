import { BaseModel, column } from '@adonisjs/lucid/orm'

/** read to assign; written as `auth.getUserOrFail()` — the guard's user: an ILF */
export default class Usuario extends BaseModel {
  static table = 'usuarios'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string
}
