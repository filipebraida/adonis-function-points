import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class FpInventory extends BaseCommand {
  static commandName = 'fp:inventory'
  static description =
    'Extrai o inventário de fatos da aplicação (models, rotas, validators, handlers)'
  static options: CommandOptions = { startApp: true }

  async run() {
    this.logger.info('TODO')
  }
}
