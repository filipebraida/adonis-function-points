import { BaseModel, column } from '@adonisjs/lucid/orm'

/** read to AUTHORISE, never delivered: an FTR of `show`, and no output DET of it */
export default class Usuario extends BaseModel {
  static table = 'usuarios'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare papel: string
}
