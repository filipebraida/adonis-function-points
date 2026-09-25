import router from '@adonisjs/core/services/router'

const PedidosController = () => import('#controllers/pedidos_controller')
const ComentariosController = () => import('#controllers/comentarios_controller')

router.get('/pedidos', [PedidosController, 'index']).as('pedidos.index')
router.get('/pedidos/:id', [PedidosController, 'show']).as('pedidos.show')
router.post('/pedidos', [PedidosController, 'store']).as('pedidos.store')
router.post('/pedidos/:id/itens', [PedidosController, 'addItem']).as('pedidos.itens.store')
router
  .post('/pedidos/:id/comentarios', [PedidosController, 'comment'])
  .as('pedidos.comentarios.store')

router.get('/comentarios', [ComentariosController, 'index']).as('comentarios.index')
