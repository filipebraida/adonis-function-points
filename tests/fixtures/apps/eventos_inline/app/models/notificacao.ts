import { BaseModel, column } from '@adonisjs/lucid/orm'

/** written only by the job an INLINE listener dispatches: an ILF, and an FTR of the POST that emitted */
export default class Notificacao extends BaseModel {
  static table = 'notificacoes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare pedidoId: number

  @column()
  declare mensagem: string
}
