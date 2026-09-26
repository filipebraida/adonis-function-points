import router from '@adonisjs/core/services/router'

const VerificacoesController = () => import('#controllers/verificacoes_controller')

router.post('/verificacoes', [VerificacoesController, 'store']).as('verificacoes.store')
router.post('/verificacoes/:id/anular', [VerificacoesController, 'anular']).as('verificacoes.anular')
router.post('/verificacoes/:id/carimbar', [VerificacoesController, 'carimbar']).as('verificacoes.carimbar')
