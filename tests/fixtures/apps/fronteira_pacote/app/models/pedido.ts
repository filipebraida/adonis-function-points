import { anexo } from '@acme/anexos'
import type { Anexo } from '@acme/anexos/types'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** three columns, one of them typed by a package: the attachment is a value, its variants are values of it */
export default class Pedido extends BaseModel {
  static table = 'pedidos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare descricao: string

  @column()
  declare status: string

  @anexo()
  declare capa: Anexo | null
}
