import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import { printResult } from '../src/cli/print.js'
import { printerFor } from './printer.js'
import { runCount } from '../src/cli/runners.js'

export default class FpCount extends BaseCommand {
  static commandName = 'fp:count'
  static description = 'Count the unadjusted function points of the application'
  static options: CommandOptions = { startApp: false }

  @flags.string({ description: 'Write the result as JSON to the given path' })
  declare out?: string

  @flags.boolean({ description: 'Print JSON instead of a table' })
  declare json?: boolean

  @flags.number({ description: 'Minimum tracing coverage (0 to 1)' })
  declare minCoverage?: number

  async run() {
    this.exitCode = printResult(
      await runCount({
        root: this.app.makePath(),
        out: this.out,
        json: this.json,
        minCoverage: this.minCoverage,
      }),
      printerFor(this)
    )
  }
}
