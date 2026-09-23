import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class FpCount extends BaseCommand {
  static commandName = 'fp:count'
  static description = 'Conta pontos de função não ajustados a partir do inventário'
  static options: CommandOptions = { startApp: true }

  async run() {
    this.logger.info('TODO')
  }
}
