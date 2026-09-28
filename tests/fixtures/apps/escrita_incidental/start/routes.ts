import router from '@adonisjs/core/services/router'

const PedidosController = () => import('#controllers/pedidos_controller')

router.get('/pedidos/:id', [PedidosController, 'show'])
router.get('/catalogo', [PedidosController, 'catalogo'])
router.get('/conta/callback', [PedidosController, 'callback'])
router.post('/pedidos', [PedidosController, 'store'])
