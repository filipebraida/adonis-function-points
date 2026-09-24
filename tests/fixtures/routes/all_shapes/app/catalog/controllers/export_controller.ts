import type { HttpContext } from '@adonisjs/core/http'

export default class ExportController {
  async handle({ response }: HttpContext) {
    return response.send('ok')
  }
}
