import router from '@adonisjs/core/services/router'

const NotesController = () => import('#controllers/notes_controller')
const AboutController = () => import('#controllers/about_controller')
const PasswordController = () => import('#controllers/password_controller')

router.get('/notes', [NotesController, 'index']).as('notes.index')
router.post('/sessions/touch', [NotesController, 'touchSession']).as('sessions.touch')
router.post('/password/forgot', [PasswordController, 'forgot']).as('password.forgot')
router.get('/about', [AboutController]).as('pages.about')
