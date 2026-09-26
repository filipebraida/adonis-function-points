import type { HttpContext } from '@adonisjs/core/http'

import Categoria from '#models/categoria'
import Autor from '#models/autor'
import Livro from '#models/livro'
import ExportacaoTransformer from '#transformers/exportacao_transformer'
import LivroTransformer from '#transformers/livro_transformer'
import RecenteTransformer from '#transformers/recente_transformer'
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

  /**
   * A transformer covers ITS resource, not the page. `Categoria` leaves raw beside
   * the transformed books, so its columns count; `Autor` is covered by the nested
   * `AutorTransformer` and contributes its keys only.
   */
  async destaques({ inertia }: HttpContext) {
    const livros = await Livro.query().preload('autor').limit(3)
    const categorias = await Categoria.all()
    return inertia.render('livros/destaques', {
      livros: LivroTransformer.transform(livros),
      categorias,
    })
  }

  /** `.count()` leaves one derived scalar, not the table; `Autor.all()` leaves every column */
  async painel({ inertia }: HttpContext) {
    const total = await Livro.query().count('* as total')
    const autores = await Autor.all()
    return inertia.render('livros/painel', { total, autores })
  }

  /** the author is preloaded FOR the transformer, which emits one key from it: its table does not leave */
  async recentes({ inertia }: HttpContext) {
    const livros = await Livro.query().preload('autor').orderBy('ano', 'desc').limit(5)
    return inertia.render('livros/recentes', { livros: RecenteTransformer.transform(livros) })
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(criarLivroValidator)
    await Livro.create(payload)
    return response.redirect().toRoute('livros.index')
  }
}
