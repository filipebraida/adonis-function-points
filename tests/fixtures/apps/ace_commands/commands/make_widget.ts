import { writeFileSync } from 'node:fs'

import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/** a scaffolder: reaches no data function, so there is no transaction to identify (AFP §6.5.3) */
export default class MakeWidget extends BaseCommand {
  static commandName = 'make:widget'
  static description = 'Cria um widget'
  static options: CommandOptions = { startApp: false }

  @args.string({ description: 'Nome do widget' })
  declare name: string

  async run() {
    writeFileSync(`app/widgets/${this.name}.ts`, `export const ${this.name} = {}\n`)
    this.logger.success(`widget ${this.name} criado`)
  }
}
