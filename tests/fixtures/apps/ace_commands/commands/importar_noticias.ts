import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import Noticia from '#models/noticia'

/**
 * A batch process an operator starts: reads a feed, writes news. An EI exactly
 * like a `POST` — its input DETs are the flags, exact, better than a validator.
 */
export default class ImportarNoticias extends BaseCommand {
  static commandName = 'noticias:importar'
  static description = 'Importa as notícias do portal antigo'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Quantas importar' })
  declare limite?: number

  @flags.string({ description: 'Só as modificadas após esta data' })
  declare desde?: string

  @flags.boolean({ description: 'Sobrescreve as já importadas' })
  declare atualizar: boolean

  async run() {
    const itens = await buscarFeed(this.desde, this.limite)
    for (const item of itens) {
      await Noticia.updateOrCreate({ slug: item.slug }, { ...item, fonte: 'portal-antigo' })
    }
    this.logger.info(`${itens.length} notícias importadas`)
  }
}

async function buscarFeed(desde?: string, limite?: number) {
  const response = await fetch(`https://portal.example/feed?desde=${desde ?? ''}&limite=${limite ?? 50}`)
  return (await response.json()) as { slug: string; titulo: string; corpo: string; publicadaEm: Date }[]
}
