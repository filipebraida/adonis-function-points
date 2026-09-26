import type { HttpContext } from '@adonisjs/core/http'

import Livro from '#models/livro'

/**
 * Every transaction hands `Livro` rows to a page RAW — no transformer, no select.
 * What leaves is what the page shows, and the page is TypeScript the same reader
 * can open (plan 0.7 §B / 0.8 §D).
 */
export default class LivrosController {
  /** the page reads three of nine columns off each row */
  async index({ inertia }: HttpContext) {
    const livros = await Livro.query().orderBy('titulo')
    return inertia.render('livros/index', { livros })
  }

  /** the page hands the row whole to ONE child component, which shows two columns */
  async show({ params, inertia }: HttpContext) {
    const livro = await Livro.findOrFail(params.id)
    return inertia.render('livros/show', { livro })
  }

  /** the rows go two components deep: the reader stops at one, and every column counts, reported */
  async destaques({ inertia }: HttpContext) {
    const livros = await Livro.query().where('destaque', true).limit(4)
    return inertia.render('livros/destaques', { livros })
  }

  /** an Edge template: `@each(livro in livros)` showing two columns */
  async catalogo({ view, response }: HttpContext) {
    const livros = await Livro.query().orderBy('titulo')
    response.header('content-type', 'application/xml')
    return response.send(await view.render('catalogo', { livros }))
  }

  /** the page nobody can find: two files answer to the name — every column, reported */
  async ambiguo({ inertia }: HttpContext) {
    const livros = await Livro.query().orderBy('ano')
    return inertia.render('livros/ambiguo', { livros })
  }
}
