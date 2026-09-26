import { BaseModel, column } from '@adonisjs/lucid/orm'

/** read before the transaction, never written: an EIF */
export default class Pessoa extends BaseModel {
  static table = 'pessoas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare cpf: string
}
