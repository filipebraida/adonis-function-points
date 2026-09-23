import type { HttpContext } from '@adonisjs/core/http'

import Book from '#catalog/models/book'
import CreateBook from '#catalog/actions/create_book'
import { createBookValidator } from '#catalog/validators/book'

export default class BooksController {
  async index({ inertia }: HttpContext) {
    const books = await Book.query().preload('author')
    return inertia.render('books/index', { books })
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createBookValidator)
    await new CreateBook().handle(payload)
    return response.redirect().toRoute('books.index')
  }

  async destroy({ params, response }: HttpContext) {
    const book = await Book.findOrFail(params.id)
    await book.delete()
    return response.redirect().toRoute('books.index')
  }
}
