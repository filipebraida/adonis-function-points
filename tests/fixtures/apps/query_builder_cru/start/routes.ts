import router from '@adonisjs/core/services/router'

const PainelController = () => import('#controllers/painel_controller')

router.get('/painel', [PainelController, 'index']).as('painel.index')
router.get('/painel/equipe', [PainelController, 'equipe']).as('painel.equipe')
router.get('/painel/carga', [PainelController, 'carga']).as('painel.carga')
router.post('/painel/:id/reatribuir', [PainelController, 'reatribuir']).as('painel.reatribuir')
router.post('/painel/lote', [PainelController, 'lote']).as('painel.lote')
router.get('/painel/pares', [PainelController, 'pares']).as('painel.pares')
router.get('/painel/config', [PainelController, 'config']).as('painel.config')
router.get('/painel/arquivo', [PainelController, 'arquivo']).as('painel.sql')
router.get('/painel/sql', [PainelController, 'sql']).as('painel.sql')
