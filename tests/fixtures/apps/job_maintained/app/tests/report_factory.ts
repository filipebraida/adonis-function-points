import ReportLine from '#models/report_line'

/**
 * A test factory's write is not the application maintaining anything either. It sits
 * under `app/` because the suite is organised by module, which is where the top-level
 * filter on scan roots never looks.
 */
export const makeLine = () => ReportLine.create({ reportId: 1, label: 'x', amount: 0 })
