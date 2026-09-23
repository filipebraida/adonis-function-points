import Book from '#admin/catalog/models/book'

export default class CreateBook {
  async handle(payload: { authorId: number; title: string; isbn?: string }) {
    return Book.create(payload)
  }
}
