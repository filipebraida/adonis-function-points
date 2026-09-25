import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Written only by the listener bound with an explicit method name. */
export default class CarrierNotice extends BaseModel {
  static table = 'carrier_notices'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare orderId: number
}
