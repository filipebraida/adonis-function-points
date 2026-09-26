import router from '@adonisjs/core/services/router'

const PedidosController = () => import('#controllers/pedidos_controller')

router.get('/pedidos', [PedidosController, 'index']).as('pedidos.index')
router.get('/pedidos/resumo', [PedidosController, 'resumo']).as('pedidos.resumo')
router.post('/pedidos', [PedidosController, 'store']).as('pedidos.store')
router.get('/sobre', [PedidosController, 'sobre']).as('sobre')
router.get('/painel/contagem', [PedidosController, 'contagem']).as('painel.contagem')
router.on('/ajuda').redirect('/sobre')
