import type { HttpContext } from '@adonisjs/core/http'

import NotifyOwnerJob from '#jobs/notify_owner_job'

import Country from '#models/country'
import ExchangeRate from '#models/exchange_rate'
import Report from '#models/report'
import Visit from '#models/visit'

export default class ReportsController {
  async index({ inertia }: HttpContext) {
    const reports = await Report.all()
    const rates = await ExchangeRate.all()

    /** reference data, written only by the seed: read here, never maintained here */
    const countries = await Country.all()

    return inertia.render('reports/index', { reports, rates, countries })
  }

  /**
   * A screen that records the visit. §6.5.3 reads "modifies a data store" as EI, and
   * the CPM asks what the elementary process is FOR: showing the report. The write is
   * declared incidental, so the transaction is an EO — and `visits` is still written by
   * this application, so it stays an ILF.
   */
  async show({ params, inertia }: HttpContext) {
    const report = await Report.findOrFail(params.id)
    await this.recordVisit(report.id)

    return inertia.render('reports/show', { report })
  }

  private async recordVisit(reportId: number) {
    await Visit.create({ reportId })
  }

  /**
   * The write goes through the relation. `relationTargetOf` reads the CURRENT
   * method, which here is `create` — so without looking back up the chain the
   * write lands on `reports` alone and `report_lines` looks read-only.
   */
  async addLine({ params, request, response }: HttpContext) {
    const report = await Report.findOrFail(params.id)
    await report.related('lines').create({ label: request.input('label'), amount: 0 })

    return response.created({})
  }

  async notify({ params, response }: HttpContext) {
    await NotifyOwnerJob.dispatch({ reportId: Number(params.id) })
    return response.noContent()
  }
}
