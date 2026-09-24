import type { HttpContext } from '@adonisjs/core/http'

/** Não alcança dado nenhum: pela decisão §1, não é função transacional. */
export default class AboutController {
  async handle({ inertia }: HttpContext) {
    return inertia.render('pages/about', { version: '1.0' })
  }
}
