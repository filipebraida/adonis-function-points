import type { HttpContext } from '@adonisjs/core/http'

import Comentario from '#models/comentario'

export default class ComentariosController {
  /** addresses `Comentario` directly: the user sees it outside its order */
  async index({ inertia }: HttpContext) {
    const comentarios = await Comentario.query().orderBy('id', 'desc')
    return inertia.render('comentarios/index', { comentarios })
  }
}
