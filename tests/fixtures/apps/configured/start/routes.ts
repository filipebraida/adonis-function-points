import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

router.get('/books', [controllers.Books, 'index']).as('books.index')
router.post('/books', [controllers.Books, 'store']).as('books.store')
router.delete('/books/:id', [controllers.Books, 'destroy']).as('books.destroy')
