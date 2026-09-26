import router from '@adonisjs/core/services/router'

const LivrosController = () => import('#controllers/livros_controller')

router.get('/livros', [LivrosController, 'index']).as('livros.index')
router.get('/livros/destaques', [LivrosController, 'destaques']).as('livros.destaques')
router.get('/livros/ambiguo', [LivrosController, 'ambiguo']).as('livros.ambiguo')
router.get('/livros/:id', [LivrosController, 'show']).as('livros.show')
router.get('/catalogo.xml', [LivrosController, 'catalogo']).as('livros.catalogo')
