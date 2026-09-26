import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

import Documento from '#models/documento'

/** read to reach its documents; written through `documento.pasta` — a relation read off a loaded row: an ILF */
export default class Pasta extends BaseModel {
  static table = 'pastas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @hasMany(() => Documento)
  declare documentos: HasMany<typeof Documento>
}
