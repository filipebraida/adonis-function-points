import router from '@adonisjs/core/services/router'

const DocumentsController = () => import('#controllers/documents_controller')
const NotesController = () => import('#controllers/notes_controller')

router.delete('/documents/:id', [DocumentsController, 'destroy']).as('documents.destroy')
router.post('/documents/purge', [DocumentsController, 'purge']).as('documents.purge')
router.post('/notes', [NotesController, 'store']).as('notes.store')
