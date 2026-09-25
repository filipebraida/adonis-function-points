import ExchangeRate from '#models/exchange_rate'
import Report from '#models/report'

/**
 * Reached by a scheduler, never by a route. The write it performs is the only
 * one in the application, so a graph walked from HTTP entry points alone sees
 * `reports` as read-only and classifies it as somebody else's table.
 */
export default class RefreshReportsJob {
  async handle() {
    const rate = await ExchangeRate.findByOrFail('currency', 'BRL')
    await Report.create({ title: 'daily', total: rate.rate })
  }
}
