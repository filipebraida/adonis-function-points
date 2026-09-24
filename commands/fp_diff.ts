import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'

import { analyze } from '../src/pipeline.js'
import { IncomparableRulesetsError, diffCounts } from '../src/albrecht/diff.js'
import { renderDiff } from '../src/reporters/table.js'
import type { CountResult } from '../src/types.js'

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

  @flags.string({ description: 'Preset of factors per change type' })
  declare preset?: string

  async run() {
    const previous = JSON.parse(await readFile(this.previous, 'utf8')) as CountResult
    const { count } = await analyze(this.app.makePath())

    try {
      this.logger.log(
        renderDiff(diffCounts(previous, count, { labels: { from: this.previous, to: 'current' } }))
      )
    } catch (error) {
      if (error instanceof IncomparableRulesetsError) {
        this.logger.error(error.message)
        this.exitCode = 1
        return
      }
      throw error
    }
  }
}
