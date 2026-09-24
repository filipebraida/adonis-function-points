import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Written ONLY inside the transformer, so it is only reachable through it. */
export default class Audit extends BaseModel {
  static table = 'audits'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare action: string
}
