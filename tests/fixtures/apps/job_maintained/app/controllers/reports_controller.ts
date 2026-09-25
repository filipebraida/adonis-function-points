import type { HttpContext } from '@adonisjs/core/http'

import NotifyOwnerJob from '#jobs/notify_owner_job'

import ExchangeRate from '#models/exchange_rate'
import Report from '#models/report'

export default class ReportsController {
  async index({ inertia }: HttpContext) {
    const reports = await Report.all()
    const rates = await ExchangeRate.all()
    return inertia.render('reports/index', { reports, rates })
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
