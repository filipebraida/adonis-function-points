import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import { printResult } from '../src/cli/print.js'
import { runCalibrate } from '../src/cli/runners.js'

/**
 * Measures the counter's bias against a manual count.
 *
 * It does NOT apply the factor: calibrating is a decision for whoever signs the
 * contract, and a factor applied silently would stop the count from being
 * reproducible from the code.
 */
export default class FpCalibrate extends BaseCommand {
  static commandName = 'fp:calibrate'
  static description = 'Compare the automatic count against manual counts'
  static options: CommandOptions = { startApp: false }

  @args.string({ description: 'CSV of `function,fp` counted by hand' })
  declare samples: string

  async run() {
    this.exitCode = printResult(
      await runCalibrate({ root: this.app.makePath(), samples: this.samples }),
      this.logger
    )
  }
}
