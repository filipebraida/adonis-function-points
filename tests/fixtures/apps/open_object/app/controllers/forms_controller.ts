import type { HttpContext } from '@adonisjs/core/http'

import Form from '#models/form'
import Note from '#models/note'
import {
  createFormValidator,
  createNoteValidator,
  payValidator,
  wrappedValidator,
} from '#validators/form'

export default class FormsController {
  /**
   * Shows the forms, opaque columns included. A declaration about `Form.answers`
   * has to reach this output as well as the data function — that is what keying
   * it by origin rather than by function is for.
   */
  async index({ response }: HttpContext) {
    return response.ok(await Form.all())
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createFormValidator)
    const form = await Form.create(payload)

    return response.created(form)
  }

  /**
   * Conditional groups: the fields are in the code, just not in an object literal.
   * Read from the first literal alone this looked like an open object — five fields
   * reported as one, and `detFromSchema` could not fix it, because a group is not a
   * JSON Schema.
   */
  async pay({ request, response }: HttpContext) {
    const payload = await request.validateUsing(payValidator)

    return response.created(await Note.create(payload as never))
  }

  /** Formatting must not decide what counts. */
  async wrapped({ request, response }: HttpContext) {
    const payload = await request.validateUsing(wrappedValidator)

    return response.created(await Note.create(payload as never))
  }

  /** No opaque field anywhere: an override aimed here has nothing to replace. */
  async note({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createNoteValidator)

    return response.created(await Note.create(payload))
  }
}
