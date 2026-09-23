import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class FpExplain extends BaseCommand {
  static commandName = 'fp:explain'
  static description = 'Mostra por que uma função foi contada como foi, com procedência'
  static options: CommandOptions = { startApp: true }

  async run() {
    this.logger.info('TODO')
  }
}
