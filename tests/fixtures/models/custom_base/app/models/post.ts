import { column } from '@adonisjs/lucid/orm'

import BaseModel from '#models/base_model'

export default class Post extends BaseModel {
  static table = 'posts'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare title: string
}
