import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Maintained by another application: this one only ever reads it. AFP §6.5.4
 * calls that an EIF, and it is the control for this fixture.
 */
export default class ExchangeRate extends BaseModel {
  static table = 'exchange_rates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare currency: string

  @column()
  declare rate: number
}
