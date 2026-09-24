import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import { analyze } from '../src/pipeline.js'
import { renderExplain } from '../src/reporters/table.js'

/**
 * Por que uma função foi contada assim.
 *
 * Não é conveniência: se PF vira fatura, alguém vai contestar um número, e um
 * número sem procedência é indefensável.
 */
export default class FpExplain extends BaseCommand {
  static commandName = 'fp:explain'
  static description = 'Mostra a procedência da contagem de uma função'
  static options: CommandOptions = { startApp: false }

  @args.string({ description: 'Nome da função, ex.: "POST /books" ou "Invite"' })
  declare funcao: string

  async run() {
    const { count } = await analyze(this.app.makePath())

    const alvo = count.functions.filter((fn) =>
      fn.name.toLowerCase().includes(this.funcao.toLowerCase())
    )

    if (alvo.length === 0) {
      this.logger.error(`nenhuma função contida em "${this.funcao}"`)
      this.exitCode = 1
      return
    }

    this.logger.log(alvo.map(renderExplain).join('\n\n' + '-'.repeat(70) + '\n\n'))
  }
}
