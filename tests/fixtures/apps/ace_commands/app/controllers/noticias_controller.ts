import type { HttpContext } from '@adonisjs/core/http'

import Noticia from '#models/noticia'

/** the one HTTP transaction: the commands are counted beside it, not instead of it */
export default class NoticiasController {
  async index({ inertia }: HttpContext) {
    const noticias = await Noticia.query().orderBy('publicada_em', 'desc')
    return inertia.render('noticias/index', { noticias })
  }
}
