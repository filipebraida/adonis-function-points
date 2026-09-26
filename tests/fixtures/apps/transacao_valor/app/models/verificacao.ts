import { BaseModel, column } from '@adonisjs/lucid/orm'

/** created inside a transaction callback, then written OUTSIDE it through the value the callback returned */
export default class Verificacao extends BaseModel {
  static table = 'verificacoes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare pessoaId: number

  @column()
  declare link: string | null

  @column()
  declare status: string
}
