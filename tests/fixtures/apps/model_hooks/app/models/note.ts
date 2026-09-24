import { BaseModel, afterCreate, column } from '@adonisjs/lucid/orm'

export default class Note extends BaseModel {
  static table = 'notes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare body: string

  /** Touches only its own row: following it must add no FTR. */
  @afterCreate()
  static async reload(note: Note) {
    await note.refresh()
  }
}
