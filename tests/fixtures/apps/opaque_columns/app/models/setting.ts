import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Has an opaque column too, and NO transaction reaches it.
 *
 * It must NOT be named: an untouched blob changes no number, and warning about
 * it is the noise that teaches people to stop reading the confidence block.
 */
export default class Setting extends BaseModel {
  static table = 'settings'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare payload: Record<string, unknown>
}
