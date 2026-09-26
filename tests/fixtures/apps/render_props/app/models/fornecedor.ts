import { BaseModel, column } from '@adonisjs/lucid/orm'

/** read through the relation, never written: an EIF with 2 DETs */
export default class Fornecedor extends BaseModel {
  static table = 'fornecedores'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare cidade: string
}
