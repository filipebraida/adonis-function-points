import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { writeFile } from 'node:fs/promises'

import { analyze } from '../src/pipeline.js'

export default class FpInventory extends BaseCommand {
  static commandName = 'fp:inventory'
  static description = 'Extrai os fatos crus da aplicação: repositórios, rotas e rastreamento'
  static options: CommandOptions = { startApp: false }

  @flags.string({ description: 'Salva o inventário como JSON no caminho indicado' })
  declare out?: string

  async run() {
    const { inventory } = await analyze(this.app.makePath())

    if (this.out) {
      await writeFile(this.out, JSON.stringify(inventory, null, 2))
      this.logger.success(`inventário salvo em ${this.out}`)
      return
    }

    const { coverage } = inventory
    this.logger.log(`repositórios de dados: ${inventory.dataStores.length}`)
    this.logger.log(`pontos de entrada:     ${coverage.entryPointsTotal}`)
    this.logger.log(
      `cobertura:             ${(coverage.ratio * 100).toFixed(1)}% ` +
        `(${coverage.unresolvedCalls} chamadas não resolvidas)`
    )
  }
}
