import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

const { catalog } = controllers

router
  .get('/books', [catalog.Books, 'index'])
  .as('books.index')

router
  .post('/books', [catalog.Books, 'store'])
  .as('books.store')

router
  .delete('/books/:id', [catalog.Books, 'destroy'])
  .as('books.destroy')
