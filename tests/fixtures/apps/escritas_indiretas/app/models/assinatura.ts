import { BaseModel, column } from '@adonisjs/lucid/orm'

/** written row by row, after a query a METHOD OF THE DOCUMENT MODEL returns */
export default class Assinatura extends BaseModel {
  static table = 'assinaturas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare documentoId: number

  @column()
  declare assinadoEm: string | null
}
