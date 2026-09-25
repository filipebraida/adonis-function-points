import router from '@adonisjs/core/services/router'

const OrdersController = () => import('#controllers/orders_controller')

router.post('/orders', [OrdersController, 'store']).as('orders.store')
router.post('/orders/:id/ship', [OrdersController, 'ship']).as('orders.ship')
