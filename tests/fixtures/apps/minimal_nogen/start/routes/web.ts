import router from '@adonisjs/core/services/router'

const BooksController = () => import('#admin/catalog/controllers/books_controller')

router.get('/books', [BooksController, 'index']).as('books.index')
router.post('/books', [BooksController, 'store']).as('books.store')
router.delete('/books/:id', [BooksController, 'destroy']).as('books.destroy')
