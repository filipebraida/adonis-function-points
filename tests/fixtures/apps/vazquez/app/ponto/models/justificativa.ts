import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import Pessoa from '#ponto/models/pessoa'

export default class Justificativa extends BaseModel {
  static table = 'justificativas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare pessoaId: number

  @column()
  declare motivo: string

  @column()
  declare observacao: string | null

  @belongsTo(() => Pessoa)
  declare pessoa: BelongsTo<typeof Pessoa>
}
