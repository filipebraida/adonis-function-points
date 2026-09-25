import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import Autor from '#models/autor'

/** 9 user-recognisable columns; `id` is the surrogate key */
export default class Livro extends BaseModel {
  static table = 'livros'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare titulo: string

  @column()
  declare isbn: string

  @column()
  declare autorId: number

  @column()
  declare editora: string

  @column()
  declare ano: number

  @column()
  declare paginas: number

  @column()
  declare idioma: string

  @column()
  declare resumo: string

  @column()
  declare capaUrl: string | null

  @belongsTo(() => Autor)
  declare autor: BelongsTo<typeof Autor>
}
