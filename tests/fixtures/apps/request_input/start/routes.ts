import router from '@adonisjs/core/services/router'

const TicketsController = () => import('#controllers/tickets_controller')

router.post('/tickets', [TicketsController, 'store']).as('tickets.store')
router.post('/tickets/:id/close', [TicketsController, 'close']).as('tickets.close')
router.post('/tickets/import', [TicketsController, 'bulk']).as('tickets.bulk')
