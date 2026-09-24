import type { BaseCommand } from '@adonisjs/core/ace'

import type { Printer } from '../src/cli/print.js'

/**
 * Maps a `RunResult` onto ace's logger.
 *
 * Notes go to `info`, not `log`: they are diagnostics about the run, and under
 * `--json` they must not be mistaken for output.
 */
export function printerFor(command: BaseCommand): Printer {
  return {
    log: (message: string) => command.logger.log(message),
    error: (message: string) => command.logger.error(message),
    note: (message: string) => command.logger.info(message),
  }
}
