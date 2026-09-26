import { BaseModel, column } from '@adonisjs/lucid/orm'

/** written by an inline ARROW listener of a class event: an ILF, and an FTR of the DELETE */
export default class Auditoria extends BaseModel {
  static table = 'auditorias'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare pedidoId: number

  @column()
  declare acao: string
}
