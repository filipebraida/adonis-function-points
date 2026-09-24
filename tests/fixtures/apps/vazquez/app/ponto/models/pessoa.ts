import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

import Apontamento from '#ponto/models/apontamento'

/**
 * Trabalhador. Pertence ao controle de acesso, fora da fronteira da aplicação
 * de ponto — o gabarito a classifica como AIE.
 */
export default class Pessoa extends BaseModel {
  static table = 'pessoas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare matricula: string

  @column()
  declare nome: string

  @column()
  declare cargo: string

  @column()
  declare setor: string

  @hasMany(() => Apontamento)
  declare apontamentos: HasMany<typeof Apontamento>
}
