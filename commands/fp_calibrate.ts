import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class FpCalibrate extends BaseCommand {
  static commandName = 'fp:calibrate'
  static description = 'Compara com contagens manuais e calcula fatores de correção'
  static options: CommandOptions = { startApp: true }

  async run() {
    this.logger.info('TODO')
  }
}
