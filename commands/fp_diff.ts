import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import { printResult } from '../src/cli/print.js'
import { printerFor } from './printer.js'
import { runDiff } from '../src/cli/runners.js'

/**
 * Additions, changes and deletions between two counts — what gets invoiced.
 *
 * It works on a SAVED count (`fp:count --out`) compared against the current
 * state, never on two checkouts: booting the older version, with possibly
 * different dependencies, is a problem not worth solving.
 */
export default class FpDiff extends BaseCommand {
  static commandName = 'fp:diff'
  static description = 'Compare a saved count against the current state of the application'
  static options: CommandOptions = { startApp: false }

  @args.string({ description: 'Path to the JSON produced by `fp:count --out`' })
  declare previous: string

  async run() {
    this.exitCode = printResult(
      await runDiff({ root: this.app.makePath(), previous: this.previous }),
      printerFor(this)
    )
  }
}
