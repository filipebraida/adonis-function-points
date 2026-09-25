import router from '@adonisjs/core/services/router'

const LivrosController = () => import('#controllers/livros_controller')
const AutoresController = () => import('#controllers/autores_controller')

router.get('/livros', [LivrosController, 'index']).as('livros.index')
router.get('/livros/bruto', [LivrosController, 'bruto']).as('livros.bruto')
router.get('/livros/resumo', [LivrosController, 'resumo']).as('livros.resumo')
router.get('/livros/exportacao', [LivrosController, 'exportacao']).as('livros.exportacao')
router.get('/livros/:id', [LivrosController, 'show']).as('livros.show')
router.post('/livros', [LivrosController, 'store']).as('livros.store')

router.get('/autores', [AutoresController, 'index']).as('autores.index')
