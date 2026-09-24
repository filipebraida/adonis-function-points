import router from '@adonisjs/core/services/router'

const Notas = () => import('#faturamento/controllers/notas_controller')
const Produtos = () => import('#catalogo/controllers/produtos_controller')

router.get('/produtos', [Produtos, 'index']).as('produtos.index')
router.post('/notas/:produtoId', [Notas, 'store']).as('notas.store')
