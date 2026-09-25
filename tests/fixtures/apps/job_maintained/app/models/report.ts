import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

import ReportLine from '#models/report_line'

export default class Report extends BaseModel {
  static table = 'reports'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare total: number

  @hasMany(() => ReportLine)
  declare lines: HasMany<typeof ReportLine>
}
