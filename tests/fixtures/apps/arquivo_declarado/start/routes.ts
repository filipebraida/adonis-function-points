import router from '@adonisjs/core/services/router'

const PapeisController = () => import('#controllers/papeis_controller')
const ConfiguracoesController = () => import('#controllers/configuracoes_controller')

router.get('/papeis', [PapeisController, 'index'])
router.post('/papeis', [PapeisController, 'store'])
router.delete('/papeis/:nome', [PapeisController, 'destroy'])
router.get('/configuracoes', [ConfiguracoesController, 'show'])
router.put('/configuracoes', [ConfiguracoesController, 'update'])
router.post('/agendamentos/listar', [ConfiguracoesController, 'agendamentos'])
