import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import { printResult } from '../src/cli/print.js'
import { printerFor } from './printer.js'
import { runExplain } from '../src/cli/runners.js'

/**
 * Why a function was counted the way it was.
 *
 * Not a convenience: if function points get invoiced, someone will dispute a
 * number, and a number without provenance is indefensible.
 */
export default class FpExplain extends BaseCommand {
  static commandName = 'fp:explain'
  static description = "Show the provenance of a function's count"
  static options: CommandOptions = { startApp: false }

  @args.string({ description: 'Function name, e.g. "POST /books" or "Invite"' })
  declare name: string

  async run() {
    this.exitCode = printResult(
      await runExplain({ root: this.app.makePath(), name: this.name }),
      printerFor(this)
    )
  }
}
