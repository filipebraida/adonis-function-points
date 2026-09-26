import type { HttpContext } from '@adonisjs/core/http'

import PasswordResetToken from '#models/password_reset_token'

export default class PasswordController {
  /** reaches only a technical table: the table leaves the count, and so does this */
  async forgot({ request, response }: HttpContext) {
    await PasswordResetToken.create({ email: request.input('email'), token: 'x' })
    return response.redirect().back()
  }
}
