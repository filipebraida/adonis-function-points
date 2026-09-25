import router from '@adonisjs/core/services/router'

const ReportsController = () => import('#controllers/reports_controller')

router.get('/reports', [ReportsController, 'index']).as('reports.index')
router.post('/reports/:id/notify', [ReportsController, 'notify']).as('reports.notify')
router.post('/reports/:id/lines', [ReportsController, 'addLine']).as('reports.lines')
