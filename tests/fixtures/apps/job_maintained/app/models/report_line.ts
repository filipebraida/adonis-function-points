import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Written ONLY through a relation: `report.related('lines').create(…)`. Nothing
 * names this model on the left of a write, so treating every relation access as a
 * read made it look like a table another application maintains.
 */
export default class ReportLine extends BaseModel {
  static table = 'report_lines'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare reportId: number

  @column()
  declare label: string

  @column()
  declare amount: number
}
