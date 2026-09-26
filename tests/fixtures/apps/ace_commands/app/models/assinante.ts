import { BaseModel, column } from '@adonisjs/lucid/orm'

/** read by the report command and the page, maintained by nobody here: an EIF */
export default class Assinante extends BaseModel {
  static table = 'assinantes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare email: string

  @column()
  declare ativo: boolean
}
