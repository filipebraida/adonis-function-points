import { BaseModel, column } from '@adonisjs/lucid/orm'

/** written only by a service instantiated in a LOCAL (`const svc = new Notificador()`) */
export default class Notificacao extends BaseModel {
  static table = 'notificacoes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare documentoId: number

  @column()
  declare mensagem: string
}
