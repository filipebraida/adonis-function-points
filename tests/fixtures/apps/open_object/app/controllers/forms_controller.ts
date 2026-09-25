import type { HttpContext } from '@adonisjs/core/http'

import Form from '#models/form'
import Note from '#models/note'
import { createFormValidator, createNoteValidator } from '#validators/form'

export default class FormsController {
  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createFormValidator)
    const form = await Form.create(payload)

    return response.created(form)
  }

  /** No opaque field anywhere: an override aimed here has nothing to replace. */
  async note({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createNoteValidator)

    return response.created(await Note.create(payload))
  }
}
