import router from '@adonisjs/core/services/router'

const NotesController = () => import('#controllers/notes_controller')

router.post('/notes', [NotesController, 'store']).as('notes.store')
router.post('/notes/archive', [NotesController, 'archive']).as('notes.archive')
