import router from '@adonisjs/core/services/router'

const Itens = () => import('#controllers/itens_controller')

router.post('/itens', [Itens, 'store']).as('itens.store')
