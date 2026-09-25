import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { DateTime } from 'luxon'

/**
 * Three user-recognisable columns, one surrogate key, two system timestamps.
 * `concluidaEm` is the control: a date the USER sets, which counts.
 */
export default class Tarefa extends BaseModel {
  static table = 'tarefas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare titulo: string

  @column()
  declare concluida: boolean

  @column.dateTime()
  declare concluidaEm: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
