import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Aviso extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare titulo: string
}
