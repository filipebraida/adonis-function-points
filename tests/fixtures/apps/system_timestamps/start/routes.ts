import router from '@adonisjs/core/services/router'

const TarefasController = () => import('#controllers/tarefas_controller')

router.get('/tarefas', [TarefasController, 'index']).as('tarefas.index')
router.get('/tarefas/recentes', [TarefasController, 'recentes']).as('tarefas.recentes')
router.post('/tarefas', [TarefasController, 'store']).as('tarefas.store')
