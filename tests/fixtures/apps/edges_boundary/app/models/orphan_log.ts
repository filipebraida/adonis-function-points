import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Nenhuma transação alcança esta tabela. Pela AFP §6.5.4, não conta. */
export default class OrphanLog extends BaseModel {
  static table = 'orphan_logs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare message: string
}
