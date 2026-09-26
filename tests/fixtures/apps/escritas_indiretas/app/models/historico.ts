import { BaseModel, column } from '@adonisjs/lucid/orm'

/** written only by a service the CONTAINER resolves */
export default class Historico extends BaseModel {
  static table = 'historicos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare documentoId: number

  @column()
  declare usuarioId: number

  @column()
  declare quando: string
}
