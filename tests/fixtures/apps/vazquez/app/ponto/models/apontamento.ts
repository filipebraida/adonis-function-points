import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'

import Justificativa from '#ponto/models/justificativa'
import Pessoa from '#ponto/models/pessoa'

export default class Apontamento extends BaseModel {
  static table = 'apontamentos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare pessoaId: number

  @column()
  declare justificativaId: number | null

  @column.dateTime()
  declare marcadoEm: DateTime

  @column()
  declare tipo: string

  @belongsTo(() => Pessoa)
  declare pessoa: BelongsTo<typeof Pessoa>

  @belongsTo(() => Justificativa)
  declare justificativa: BelongsTo<typeof Justificativa>
}
