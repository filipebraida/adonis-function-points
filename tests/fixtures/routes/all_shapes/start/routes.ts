import router from '@adonisjs/core/services/router'

import { controllers } from '#generated/controllers'

// alias local por lazy import — estilo sem mapa gerado
const ExportController = () => import('#catalog/controllers/export_controller')

const { catalog, admin } = controllers

// 1. uma linha
router.get('/health', [catalog.Books, 'index']).as('health')

// 2. multi-linha encadeada: a quebra fica DENTRO do texto da expressão
router
  .post('/books/:id/export', [ExportController])
  .where('id', router.matchers.number())
  .as('books.export')

// 3. resource com .only()
router.resource('/books', catalog.Books).only(['index', 'show', 'store']).as('books')

// 4. grupo com prefixo e nome — o prefixo tem que chegar ao padrão final
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

// 7. rota estática: nenhum handler para analisar
router.on('/about').renderInertia('pages/about').as('pages.about')

// 8. closure inline: é handler de verdade, com corpo a analisar
router
  .get('/ping', ({ response }) => {
    return response.send('pong')
  })
  .as('ping')
