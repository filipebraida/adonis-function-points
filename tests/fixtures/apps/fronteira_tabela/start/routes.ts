import router from '@adonisjs/core/services/router'

const PedidosController = () => import('#controllers/pedidos_controller')

router.get('/pedidos', [PedidosController, 'index']).as('pedidos.index')
router.post('/pedidos', [PedidosController, 'store']).as('pedidos.store')
router.get('/painel/registros', [PedidosController, 'registros']).as('painel.registros')
router.get('/painel/resumo', [PedidosController, 'resumo']).as('painel.resumo')
router.post('/painel/registros', [PedidosController, 'anotar']).as('painel.anotar')
