import router from '@adonisjs/core/services/router'

const PedidosController = () => import('#controllers/pedidos_controller')

router.get('/pedidos/:id', [PedidosController, 'show'])
router.post('/organizacao/trocar', [PedidosController, 'trocar'])
router.post('/pedidos', [PedidosController, 'store'])
