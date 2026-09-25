import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import { printResult } from '../src/cli/print.js'
import { printerFor } from './printer.js'
import { runMetrics } from '../src/cli/runners.js'

export default class FpMetrics extends BaseCommand {
  static commandName = 'fp:metrics'
  static description = 'Density, coupling and conformance, derived from the same inventory'
  static options: CommandOptions = { startApp: false }

  @flags.string({ description: 'Write the metrics as JSON to the given path' })
  declare out?: string

  @flags.boolean({ description: 'Print JSON instead of a table' })
  declare json?: boolean

  async run() {
    this.exitCode = printResult(
      await runMetrics({ root: this.app.makePath(), out: this.out, json: this.json }),
      printerFor(this)
    )
  }
}
