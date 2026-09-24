import type { HttpContext } from '@adonisjs/core/http'

import Note from '#models/note'
import UserSession from '#models/user_session'

export default class NotesController {
  async index({ inertia }: HttpContext) {
    const notes = await Note.all()
    return inertia.render('notes/index', { notes })
  }

  /** reaches the technical table: it is used, but must not count */
  async touchSession({ response }: HttpContext) {
    await UserSession.create({ token: 'x' })
    return response.redirect().back()
  }
}
