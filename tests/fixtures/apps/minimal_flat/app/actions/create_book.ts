import Book from '#models/book'

export default class CreateBook {
  async handle(payload: { authorId: number; title: string; isbn?: string }) {
    return Book.create(payload)
  }
}
