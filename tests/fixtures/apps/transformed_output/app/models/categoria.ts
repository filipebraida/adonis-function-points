import { BaseModel, column } from '@adonisjs/lucid/orm'

/** read raw beside a transformed store: no transformer covers it, so every column leaves */
export default class Categoria extends BaseModel {
  static table = 'categorias'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare descricao: string
}
