import { BaseModel as AdonisBaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class BaseModel extends AdonisBaseModel {
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
