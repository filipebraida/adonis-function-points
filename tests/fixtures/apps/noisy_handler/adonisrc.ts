import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({ preloads: [() => import('#start/routes')] })
