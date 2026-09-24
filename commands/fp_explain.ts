import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import { analyze } from '../src/pipeline.js'
import { renderExplain } from '../src/reporters/table.js'

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
    const { count } = await analyze(this.app.makePath())

    const matched = count.functions.filter((fn) =>
      fn.name.toLowerCase().includes(this.name.toLowerCase())
    )

    if (matched.length === 0) {
      this.logger.error(`no function matching "${this.name}"`)
      this.exitCode = 1
      return
    }

    this.logger.log(matched.map(renderExplain).join('\n\n' + '-'.repeat(70) + '\n\n'))
  }
}
