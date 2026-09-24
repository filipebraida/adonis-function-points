import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Written ONLY by `Document`'s `@beforeDelete` hook.
 *
 * That is the shape where ignoring hooks costs a whole data function: with no
 * transaction reaching it, AFP §6.5.4 drops it from the count entirely.
 */
export default class Page extends BaseModel {
  static table = 'pages'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare documentId: number

  @column()
  declare body: string
}
