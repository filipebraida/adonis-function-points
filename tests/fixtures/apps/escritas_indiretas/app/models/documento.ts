import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import Assinatura from '#models/assinatura'
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

  /** a query the model builds for its callers — no annotation; every return is `Assinatura.query()` */
  pendentes(options?: { client?: unknown }) {
    return Assinatura.query({ client: options?.client as never })
      .where('documento_id', this.id)
      .whereNull('assinado_em')
  }
}
