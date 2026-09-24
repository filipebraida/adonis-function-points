import router from '@adonisjs/core/services/router'

const NotesController = () => import('#controllers/notes_controller')
const AboutController = () => import('#controllers/about_controller')

router.get('/notes', [NotesController, 'index']).as('notes.index')
router.post('/sessions/touch', [NotesController, 'touchSession']).as('sessions.touch')
router.get('/about', [AboutController]).as('pages.about')
