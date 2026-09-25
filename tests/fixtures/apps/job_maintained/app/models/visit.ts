import { BaseModel, column } from '@adonisjs/lucid/orm'

/** UX bookkeeping: which report the user last opened. */
export default class Visit extends BaseModel {
  static table = 'visits'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare reportId: number
}
