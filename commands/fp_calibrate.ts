import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'

import { analyze } from '../src/pipeline.js'
import { calibrate, parseSamples } from '../src/albrecht/calibration.js'

/**
 * Measures the counter's bias against a manual count.
 *
 * It does NOT apply the factor: calibrating is a decision for whoever signs the
 * contract, and a factor applied silently would stop the count from being
 * reproducible from the code.
 */
export default class FpCalibrate extends BaseCommand {
  static commandName = 'fp:calibrate'
  static description = 'Compare the automatic count against manual counts'
  static options: CommandOptions = { startApp: false }

  @args.string({ description: 'CSV of `function,fp` counted by hand' })
  declare samples: string

  async run() {
    const samples = parseSamples(await readFile(this.samples, 'utf8'))
    const { count } = await analyze(this.app.makePath())
    const calibration = calibrate(count, samples)

    const { overall } = calibration
    this.logger.log(
      `samples: ${overall.samples} · manual ${overall.manualPoints} FP · ` +
        `automatic ${overall.automaticPoints} FP · deviation ${(overall.deviation * 100).toFixed(1)}%`
    )
    this.logger.log(`exact matches: ${overall.exactMatches}/${overall.samples}`)
    this.logger.log('')

    for (const item of calibration.byType) {
      this.logger.log(
        `${item.type.padEnd(4)} n=${String(item.samples).padStart(3)} ` +
          `factor ${item.factor.toFixed(3)} · mean deviation ${item.meanAbsoluteDeviation} FP`
      )
    }

    for (const warning of calibration.warnings) this.logger.warning(warning)
  }
}
