import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class FpDiff extends BaseCommand {
  static commandName = 'fp:diff'
  static description =
    'Compara duas versões e classifica cada função como inclusão/alteração/exclusão'
  static options: CommandOptions = { startApp: true }

  async run() {
    this.logger.info('TODO')
  }
}
