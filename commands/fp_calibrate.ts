import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'

import { analyze } from '../src/pipeline.js'
import { calibrate, parseSamples } from '../src/albrecht/calibration.js'

/**
 * Mede o viés do contador contra contagem manual.
 *
 * NÃO aplica o fator: calibrar é decisão de quem assina o contrato, e um fator
 * aplicado em silêncio faria a contagem deixar de ser reproduzível a partir do
 * código.
 */
export default class FpCalibrate extends BaseCommand {
  static commandName = 'fp:calibrate'
  static description = 'Compara a contagem automática com contagens manuais'
  static options: CommandOptions = { startApp: false }

  @args.string({ description: 'CSV com `funcao,pf` apurados manualmente' })
  declare amostras: string

  async run() {
    const samples = parseSamples(await readFile(this.amostras, 'utf8'))
    const { count } = await analyze(this.app.makePath())
    const calibration = calibrate(count, samples)

    const { overall } = calibration
    this.logger.log(
      `amostras: ${overall.samples} · manual ${overall.manualPoints} PF · ` +
        `automático ${overall.automaticPoints} PF · desvio ${(overall.deviation * 100).toFixed(1)}%`
    )
    this.logger.log(`batem exatamente: ${overall.exactMatches}/${overall.samples}`)
    this.logger.log('')

    for (const item of calibration.byType) {
      this.logger.log(
        `${item.type.padEnd(4)} n=${String(item.samples).padStart(3)} ` +
          `fator ${item.factor.toFixed(3)} · desvio médio ${item.meanAbsoluteDeviation} PF`
      )
    }

    for (const warning of calibration.warnings) this.logger.warning(warning)
  }
}
