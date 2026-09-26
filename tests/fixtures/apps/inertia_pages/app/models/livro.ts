import { BaseModel, column } from '@adonisjs/lucid/orm'

/** nine columns, read only: an EIF at 5 whatever the pages show */
export default class Livro extends BaseModel {
  static table = 'livros'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare titulo: string

  @column()
  declare autor: string

  @column()
  declare isbn: string

  @column()
  declare ano: number

  @column()
  declare editora: string

  @column()
  declare paginas: number

  @column()
  declare idioma: string

  @column()
  declare resumo: string

  @column()
  declare capaUrl: string
}
