import router from '@adonisjs/core/services/router'

const DocumentosController = () => import('#controllers/documentos_controller')

router.patch('/documentos/:id', [DocumentosController, 'renomear']).as('documentos.renomear')
router.delete('/documentos/:id', [DocumentosController, 'excluir']).as('documentos.excluir')
router.post('/documentos/:id/arquivar', [DocumentosController, 'arquivar']).as('documentos.arquivar')
router.post('/pastas/:id/limpar', [DocumentosController, 'limpar']).as('pastas.limpar')
router.post('/documentos/:id/atribuir', [DocumentosController, 'atribuir']).as('documentos.atribuir')
router.post('/documentos/:id/notificar', [DocumentosController, 'notificar']).as('documentos.notificar')
router.post('/documentos', [DocumentosController, 'criar']).as('documentos.criar')
router.post('/documentos/:id/sessao', [DocumentosController, 'sessao']).as('documentos.sessao')
router.post('/pastas/:id/marcar', [DocumentosController, 'marcar']).as('pastas.marcar')
router.post('/perfil', [DocumentosController, 'perfil']).as('perfil')
router.post('/documentos/:id/pasta', [DocumentosController, 'renomearPasta']).as('documentos.pasta')
router.post('/documentos/:id/duplicar', [DocumentosController, 'duplicar']).as('documentos.duplicar')
router.get('/documentos/:id/exportar', [DocumentosController, 'exportar']).as('documentos.exportar')
router.post('/documentos/:id/carimbar', [DocumentosController, 'carimbar']).as('documentos.carimbar')
