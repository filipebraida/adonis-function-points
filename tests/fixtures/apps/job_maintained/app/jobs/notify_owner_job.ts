import Report from '#models/report'

/**
 * Dispatched by a route, and its execution method is `process` — the name
 * `@nemoventures/adonis-jobs` uses. When only `handle` was looked for, this
 * resolved to a file and then to no body: the dispatch was reported as an
 * unknown and the write below never counted.
 */
export default class NotifyOwnerJob {
  declare data: { reportId: number }

  async process() {
    const report = await Report.findOrFail(this.data.reportId)
    report.title = `${report.title} (sent)`
    await report.save()
  }
}
