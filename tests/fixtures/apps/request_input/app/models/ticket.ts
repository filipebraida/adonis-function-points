import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Ticket extends BaseModel {
  static table = 'tickets'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare subject: string

  @column()
  declare body: string

  @column()
  declare priority: string

  @column()
  declare closedAt: string | null
}
