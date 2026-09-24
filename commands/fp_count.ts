import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { writeFile } from 'node:fs/promises'

import { analyze } from '../src/pipeline.js'
import { renderCount } from '../src/reporters/table.js'

export default class FpCount extends BaseCommand {
  static commandName = 'fp:count'
  static description = 'Conta pontos de função não ajustados da aplicação'
  static options: CommandOptions = { startApp: false }

  @flags.string({ description: 'Salva o resultado como JSON no caminho indicado' })
  declare out?: string

  @flags.boolean({ description: 'Imprime JSON em vez de tabela' })
  declare json?: boolean

  @flags.number({ description: 'Cobertura mínima de rastreamento (0 a 1)' })
  declare minCoverage?: number

  async run() {
    const { count } = await analyze(this.app.makePath(), {
      minCoverage: this.minCoverage,
    })

    if (this.out) {
      await writeFile(this.out, JSON.stringify(count, null, 2))
      this.logger.success(`contagem salva em ${this.out}`)
    }

    this.logger.log(this.json ? JSON.stringify(count, null, 2) : renderCount(count))
  }
}
