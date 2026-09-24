import type { HttpContext } from '@adonisjs/core/http'

/** Reaches no data at all: by decision §1, not a transactional function. */
export default class AboutController {
  async handle({ inertia }: HttpContext) {
    return inertia.render('pages/about', { version: '1.0' })
  }
}
