import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Usuario extends BaseModel {
  static table = 'usuarios'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string
}
