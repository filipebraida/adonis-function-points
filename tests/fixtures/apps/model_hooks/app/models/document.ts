import { BaseModel, beforeDelete, column } from '@adonisjs/lucid/orm'

import Page from '#models/page'

export default class Document extends BaseModel {
  static table = 'documents'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  /**
   * A cascading delete. It is not a transaction of its own — it fires inside
   * one that already crossed the boundary — so under counting-decisions §3 its
   * write belongs to whichever transaction deleted the document.
   */
  @beforeDelete()
  static async removePages(document: Document) {
    await Page.query().where('documentId', document.id).delete()
  }
}
