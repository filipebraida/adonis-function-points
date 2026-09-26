import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { faker } from '@faker-js/faker'

/**
 * Generates test data. The code cannot tell a generator from an importer — both
 * write the same table — so it is COUNTED, and the report names it with the FP
 * at stake and the faker import as the hint, so a person excludes it with
 * `boundary.ignoreEntryPoints`.
 */
export default class GerarNoticias extends BaseCommand {
  static commandName = 'gerar:noticias'
  static description = 'Gera notícias falsas para desenvolvimento'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Quantas gerar' })
  declare quantidade: number

  async run() {
    // imported inside the body, so `--help` does not boot the app: the store is the same
    const { default: Noticia } = await import('#models/noticia')
    for (let i = 0; i < (this.quantidade ?? 10); i++) {
      await Noticia.create({
        titulo: faker.lorem.sentence(),
        slug: faker.lorem.slug(),
        corpo: faker.lorem.paragraphs(),
        fonte: 'faker',
        publicadaEm: faker.date.recent(),
      })
    }
  }
}
