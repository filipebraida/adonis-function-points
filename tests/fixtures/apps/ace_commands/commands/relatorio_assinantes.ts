import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import Assinante from '#models/assinante'

/**
 * A report printed to the terminal: what it prints is what leaves — the columns
 * the table shows, read off the rows, and the count. An EO with one FTR.
 */
export default class RelatorioAssinantes extends BaseCommand {
  static commandName = 'assinantes:relatorio'
  static description = 'Lista os assinantes'
  static options: CommandOptions = { startApp: true }

  @flags.boolean({ description: 'Só os ativos', flagName: 'ativos' })
  declare somenteAtivos: boolean

  async run() {
    const query = Assinante.query().orderBy('nome')
    if (this.somenteAtivos) query.where('ativo', true)
    const assinantes = await query

    const table = this.ui.table().head(['Nome', 'E-mail'])
    for (const assinante of assinantes) table.row([assinante.nome, assinante.email])
    table.render()

    this.logger.info(`${assinantes.length} assinante(s)`)
  }
}
