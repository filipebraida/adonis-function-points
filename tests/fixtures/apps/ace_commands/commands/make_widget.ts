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
    // a method on a flag/argument property is the language's: `this.name` is a string
    const nome = this.name.trim()
    writeFileSync(`app/widgets/${nome}.ts`, `export const ${nome} = {}\n`)
    this.logger.success(`widget ${this.name} criado`)
  }
}
