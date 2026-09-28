import { BaseModel, column } from '@adonisjs/lucid/orm'

/** the link between the user and an external identity provider */
export default class Conta extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare provedor: string

  @column()
  declare externoId: string
}
