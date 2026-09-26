import { BaseModel, column } from '@adonisjs/lucid/orm'

/** written through an instance a SERVICE returns (`Promise<Sessao | null>`) */
export default class Sessao extends BaseModel {
  static table = 'sessoes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare documentoId: number

  @column()
  declare encerradaEm: string | null
}
