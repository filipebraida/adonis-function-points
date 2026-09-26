import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

import Livro from '#models/livro'

/** read through the relation, never written: an EIF. 3 DETs, one of them hidden from every output */
export default class Autor extends BaseModel {
  static table = 'autores'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare pais: string

  /** never serialised by Lucid: a DET of the file, never of an output */
  @column({ serializeAs: null })
  declare cpf: string

  @hasMany(() => Livro)
  declare livros: HasMany<typeof Livro>
}
