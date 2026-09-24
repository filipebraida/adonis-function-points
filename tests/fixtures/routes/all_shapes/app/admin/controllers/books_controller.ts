import type { HttpContext } from '@adonisjs/core/http'

export default class BooksController {
  async index({ inertia }: HttpContext) {
    return inertia.render('admin/books', {})
  }
  async show({ inertia }: HttpContext) {
    return inertia.render('admin/book', {})
  }
  async store({ response }: HttpContext) {
    return response.redirect().back()
  }
  async update({ response }: HttpContext) {
    return response.redirect().back()
  }
  async destroy({ response }: HttpContext) {
    return response.redirect().back()
  }
}
