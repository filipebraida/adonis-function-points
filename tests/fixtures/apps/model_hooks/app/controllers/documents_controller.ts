import Document from '#models/document'

export default class DocumentsController {
  /**
   * Instance delete: Lucid fires the model's hooks, so the cascade into `Page`
   * is part of THIS transaction.
   */
  async destroy({ params }: { params: { id: number } }) {
    const document = await Document.findOrFail(params.id)
    await document.delete()
  }

  /**
   * Query-builder delete: Lucid does NOT fire instance hooks for a bulk
   * operation, so `Page` is not reached. Following hooks here would invent an
   * FTR — and counting more than is there is worse than counting less.
   */
  async purge() {
    await Document.query().where('title', 'draft').delete()
  }
}
