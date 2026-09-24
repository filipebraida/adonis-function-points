import { BaseModel, column } from '@adonisjs/lucid/orm'

/** No transaction reaches this table. Under AFP §6.5.4, it does not count. */
export default class OrphanLog extends BaseModel {
  static table = 'orphan_logs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare message: string
}
