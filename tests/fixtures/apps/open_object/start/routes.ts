import router from '@adonisjs/core/services/router'

const FormsController = () => import('#controllers/forms_controller')

router.post('/forms', [FormsController, 'store']).as('forms.store')
router.post('/notes', [FormsController, 'note']).as('notes.store')
router.post('/pay', [FormsController, 'pay']).as('pay.store')
