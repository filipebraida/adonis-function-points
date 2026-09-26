import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import Pasta from '#models/pasta'

/** written by every action of this fixture — through an instance that arrives from outside the body that writes */
export default class Documento extends BaseModel {
  static table = 'documentos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare conteudo: string

  @column()
  declare arquivado: boolean

  @column()
  declare pastaId: number

  @column()
  declare responsavelId: number | null

  @belongsTo(() => Pasta)
  declare pasta: BelongsTo<typeof Pasta>
}
