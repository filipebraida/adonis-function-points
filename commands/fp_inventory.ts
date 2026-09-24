import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import { printResult } from '../src/cli/print.js'
import { printerFor } from './printer.js'
import { runInventory } from '../src/cli/runners.js'

export default class FpInventory extends BaseCommand {
  static commandName = 'fp:inventory'
  static description = 'Extract the raw facts of the application: stores, routes and tracing'
  static options: CommandOptions = { startApp: false }

  @flags.string({ description: 'Write the inventory as JSON to the given path' })
  declare out?: string

  async run() {
    this.exitCode = printResult(
      await runInventory({ root: this.app.makePath(), out: this.out }),
      printerFor(this)
    )
  }
}
