import { BaseModel, column } from '@adonisjs/lucid/orm'

/** what the application remembers about the user: the organisation last used */
export default class Preferencia extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare chave: string

  @column()
  declare valor: string
}
