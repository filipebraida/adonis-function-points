import type { HttpContext } from '@adonisjs/core/http'

import Livro from '#models/livro'
import ExportacaoTransformer from '#transformers/exportacao_transformer'
import LivroTransformer from '#transformers/livro_transformer'
import { criarLivroValidator } from '#validators/livro'

export default class LivrosController {
  /** through the transformer: 4 output DETs */
  async index({ inertia }: HttpContext) {
    const livros = await Livro.query().preload('autor').orderBy('titulo')
    return inertia.render('livros/index', { livros: LivroTransformer.transform(livros) })
  }

  /** the models, untouched: every column of both stores */
  async bruto({ inertia }: HttpContext) {
    const livros = await Livro.query().preload('autor').orderBy('titulo')
    return inertia.render('livros/bruto', { livros })
  }

  /** `.select([...])` narrows the store's columns to the two named */
  async resumo({ inertia }: HttpContext) {
    const livros = await Livro.query().select(['titulo', 'ano']).orderBy('ano')
    return inertia.render('livros/resumo', { livros })
  }

  /** a transformer method other than `toObject`, reached through `new X().method()` */
  async show({ params, inertia }: HttpContext) {
    const livro = await Livro.query().where('id', params.id).preload('autor').firstOrFail()
    return inertia.render('livros/show', { livro: new LivroTransformer(livro).forDetalhe() })
  }

  /** a spread the analysis cannot read: 1 DET as a floor, and reported */
  async exportacao({ inertia }: HttpContext) {
    const livros = await Livro.query().orderBy('titulo')
    return inertia.render('livros/exportacao', { livros: ExportacaoTransformer.transform(livros) })
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(criarLivroValidator)
    await Livro.create(payload)
    return response.redirect().toRoute('livros.index')
  }
}
