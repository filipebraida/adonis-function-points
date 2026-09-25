import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Written ONLY by a listener. Nothing else in the application touches it, so if
 * the dispatch is not followed this table does not exist as far as the count is
 * concerned.
 */
export default class StockMovement extends BaseModel {
  static table = 'stock_movements'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare orderId: number

  @column()
  declare quantity: number
}
