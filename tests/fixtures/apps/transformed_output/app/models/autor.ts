import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

import Livro from '#models/livro'

/** read through the relation, never written: an EIF */
export default class Autor extends BaseModel {
  static table = 'autores'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare pais: string

  @hasMany(() => Livro)
  declare livros: HasMany<typeof Livro>
}
