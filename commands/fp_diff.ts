import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'

import { analyze } from '../src/pipeline.js'
import { IncomparableRulesetsError, diffCounts } from '../src/albrecht/diff.js'
import { renderDiff } from '../src/reporters/table.js'
import type { CountResult } from '../src/types.js'

/**
 * Inclusão, alteração e exclusão entre duas contagens — o que vira fatura.
 *
 * Opera sobre uma contagem SALVA (`fp:count --out`) comparada com o estado
 * atual, nunca sobre dois checkouts: bootar a versão antiga, com dependências
 * possivelmente diferentes, é problema que não vale resolver.
 */
export default class FpDiff extends BaseCommand {
  static commandName = 'fp:diff'
  static description = 'Compara uma contagem salva com o estado atual da aplicação'
  static options: CommandOptions = { startApp: false }

  @args.string({ description: 'Caminho do JSON gerado por `fp:count --out`' })
  declare anterior: string

  @flags.string({ description: 'Preset de fatores por tipo de mudança' })
  declare preset?: string

  async run() {
    const previous = JSON.parse(await readFile(this.anterior, 'utf8')) as CountResult
    const { count } = await analyze(this.app.makePath())

    try {
      this.logger.log(
        renderDiff(diffCounts(previous, count, { labels: { from: this.anterior, to: 'atual' } }))
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
