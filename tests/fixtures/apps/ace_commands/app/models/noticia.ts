import { BaseModel, column } from '@adonisjs/lucid/orm'

/** written only by the import command: an ILF all the same — a batch process maintains it */
export default class Noticia extends BaseModel {
  static table = 'noticias'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare titulo: string

  @column()
  declare slug: string

  @column()
  declare corpo: string

  @column()
  declare fonte: string

  @column.dateTime()
  declare publicadaEm: Date
}
