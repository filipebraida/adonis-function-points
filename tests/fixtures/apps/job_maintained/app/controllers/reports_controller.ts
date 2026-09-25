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

  async notify({ params, response }: HttpContext) {
    await NotifyOwnerJob.dispatch({ reportId: Number(params.id) })
    return response.noContent()
  }
}
