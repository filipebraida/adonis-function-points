import { Job } from '@adonisjs/queue'

import Noticia from '#models/noticia'

/** dispatched by the import command: part of THAT transaction (§9), nothing to report */
export default class IndexarNoticiaJob extends Job<{ slug: string }> {
  async execute() {
    const noticia = await Noticia.findByOrFail('slug', this.payload.slug)
    await fetch(`https://busca.example/index`, { method: 'POST', body: JSON.stringify(noticia) })
  }
}
