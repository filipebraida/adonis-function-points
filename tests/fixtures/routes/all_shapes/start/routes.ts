import router from '@adonisjs/core/services/router'

import { controllers } from '#generated/controllers'

// alias local por lazy import — estilo sem mapa gerado
const ExportController = () => import('#catalog/controllers/export_controller')

const { catalog, admin } = controllers

// 1. uma linha
router.get('/health', [catalog.Books, 'index']).as('health')

// 2. chained multi-line: the break sits INSIDE the expression text
router
  .post('/books/:id/export', [ExportController])
  .where('id', router.matchers.number())
  .as('books.export')

// 3. resource com .only()
router.resource('/books', catalog.Books).only(['index', 'show', 'store']).as('books')

// 4. group with prefix and name — the prefix must reach the final pattern
router
  .group(() => {
    router.get('/books', [admin.Books, 'index']).as('books.index')

    // 5. grupo ANINHADO
    router
      .group(() => {
        router.delete('/books/:uuid', [admin.Books, 'destroy']).as('books.destroy')
      })
      .prefix('/trash')
  })
  .prefix('/admin')
  .as('admin')

// 6. resource apiOnly (sem create/edit)
router.resource('/api/books', admin.Books).apiOnly().as('api.books')

// 7. static route: no handler to analyse
router.on('/about').renderInertia('pages/about').as('pages.about')

// 8. inline closure: a real handler, with a body to analyse
router
  .get('/ping', ({ response }) => {
    return response.send('pong')
  })
  .as('ping')
