import router from '@adonisjs/core/services/router'

const NoticiasController = () => import('#controllers/noticias_controller')

router.get('/noticias', [NoticiasController, 'index']).as('noticias.index')
