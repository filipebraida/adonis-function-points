import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Note extends BaseModel {
  static table = 'notes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare body: string

  @column()
  declare pinned: boolean
}
