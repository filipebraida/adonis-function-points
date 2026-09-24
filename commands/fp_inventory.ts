import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { writeFile } from 'node:fs/promises'

import { analyze } from '../src/pipeline.js'

export default class FpInventory extends BaseCommand {
  static commandName = 'fp:inventory'
  static description = 'Extract the raw facts of the application: stores, routes and tracing'
  static options: CommandOptions = { startApp: false }

  @flags.string({ description: 'Write the inventory as JSON to the given path' })
  declare out?: string

  async run() {
    const { inventory } = await analyze(this.app.makePath())

    if (this.out) {
      await writeFile(this.out, JSON.stringify(inventory, null, 2))
      this.logger.success(`inventory written to ${this.out}`)
      return
    }

    const { coverage } = inventory
    this.logger.log(`data stores:   ${inventory.dataStores.length}`)
    this.logger.log(`entry points:  ${coverage.entryPointsTotal}`)
    this.logger.log(
      `coverage:      ${(coverage.ratio * 100).toFixed(1)}% ` +
        `(${coverage.unresolvedCalls} unresolved calls)`
    )
  }
}
