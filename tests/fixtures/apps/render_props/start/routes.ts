import router from '@adonisjs/core/services/router'

const ProdutosController = () => import('#controllers/produtos_controller')

router.get('/produtos', [ProdutosController, 'index']).as('produtos.index')
router.get('/produtos/resumo', [ProdutosController, 'resumo']).as('produtos.resumo')
router.get('/produtos/destaques', [ProdutosController, 'destaques']).as('produtos.destaques')
router.get('/produtos/exportar', [ProdutosController, 'exportar']).as('produtos.exportar')
router.get('/produtos/manifesto', [ProdutosController, 'manifesto']).as('produtos.manifesto')
router.get('/produtos/:id', [ProdutosController, 'show']).as('produtos.show')
router.get('/produtos/:id/editar', [ProdutosController, 'editar']).as('produtos.editar')
router.post('/produtos', [ProdutosController, 'store']).as('produtos.store')
