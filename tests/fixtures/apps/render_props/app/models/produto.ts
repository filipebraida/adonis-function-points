import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import Fornecedor from '#models/fornecedor'

/** 5 user-recognisable columns */
export default class Produto extends BaseModel {
  static table = 'produtos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare preco: number

  @column()
  declare estoque: number

  @column()
  declare categoria: string

  @column()
  declare fornecedorId: number

  @belongsTo(() => Fornecedor)
  declare fornecedor: BelongsTo<typeof Fornecedor>
}
