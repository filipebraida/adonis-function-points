import router from '@adonisjs/core/services/router'

const PedidosController = () => import('#controllers/pedidos_controller')

router.post('/pedidos', [PedidosController, 'store']).as('pedidos.store')
router.delete('/pedidos/:id', [PedidosController, 'destroy']).as('pedidos.destroy')
