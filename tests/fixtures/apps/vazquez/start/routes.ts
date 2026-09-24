import router from '@adonisjs/core/services/router'

const Apontamentos = () => import('#ponto/controllers/apontamentos_controller')
const JustificarApontamento = () => import('#ponto/controllers/justificar_apontamento_controller')
const Presenca = () => import('#ponto/controllers/presenca_controller')

// Consulta Apontamento Diário
router.get('/apontamentos', [Apontamentos, 'index']).as('apontamentos.index')

// Registro de Ponto
router.post('/apontamentos', [Apontamentos, 'store']).as('apontamentos.store')

// Alteração de Apontamento
router.put('/apontamentos/:id', [Apontamentos, 'update']).as('apontamentos.update')

// Exclusão de Apontamento
router.delete('/apontamentos/:id', [Apontamentos, 'destroy']).as('apontamentos.destroy')

// Apontamento com Justificativa
router.post('/apontamentos/justificar', [JustificarApontamento]).as('apontamentos.justificar')

// Acompanhar Presença
router.get('/presenca', [Presenca, 'acompanhar']).as('presenca.acompanhar')

// Emitir Relatório de Presença
router.get('/presenca/relatorio', [Presenca, 'relatorio']).as('presenca.relatorio')
