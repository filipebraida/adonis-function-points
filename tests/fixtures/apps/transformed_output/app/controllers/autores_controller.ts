import type { HttpContext } from '@adonisjs/core/http'

import Autor from '#models/autor'

export default class AutoresController {
  /** `.select('nome')`, the variadic form: 1 output DET */
  async index({ inertia }: HttpContext) {
    const autores = await Autor.query().select('nome').orderBy('nome')
    return inertia.render('autores/index', { autores })
  }
}
