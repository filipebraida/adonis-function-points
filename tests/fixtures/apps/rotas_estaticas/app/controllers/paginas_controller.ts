import type { HttpContext } from '@adonisjs/core/http'

import Aviso from '#models/aviso'

/** one route that reads a store, and 27 static pages: more than the warning shows */
export default class PaginasController {
  async avisos({ response }: HttpContext) {
    return response.json(await Aviso.all())
  }

  async pagina01({ response }: HttpContext) {
    return response.send('pagina 01')
  }

  async pagina02({ response }: HttpContext) {
    return response.send('pagina 02')
  }

  async pagina03({ response }: HttpContext) {
    return response.send('pagina 03')
  }

  async pagina04({ response }: HttpContext) {
    return response.send('pagina 04')
  }

  async pagina05({ response }: HttpContext) {
    return response.send('pagina 05')
  }

  async pagina06({ response }: HttpContext) {
    return response.send('pagina 06')
  }

  async pagina07({ response }: HttpContext) {
    return response.send('pagina 07')
  }

  async pagina08({ response }: HttpContext) {
    return response.send('pagina 08')
  }

  async pagina09({ response }: HttpContext) {
    return response.send('pagina 09')
  }

  async pagina10({ response }: HttpContext) {
    return response.send('pagina 10')
  }

  async pagina11({ response }: HttpContext) {
    return response.send('pagina 11')
  }

  async pagina12({ response }: HttpContext) {
    return response.send('pagina 12')
  }

  async pagina13({ response }: HttpContext) {
    return response.send('pagina 13')
  }

  async pagina14({ response }: HttpContext) {
    return response.send('pagina 14')
  }

  async pagina15({ response }: HttpContext) {
    return response.send('pagina 15')
  }

  async pagina16({ response }: HttpContext) {
    return response.send('pagina 16')
  }

  async pagina17({ response }: HttpContext) {
    return response.send('pagina 17')
  }

  async pagina18({ response }: HttpContext) {
    return response.send('pagina 18')
  }

  async pagina19({ response }: HttpContext) {
    return response.send('pagina 19')
  }

  async pagina20({ response }: HttpContext) {
    return response.send('pagina 20')
  }

  async pagina21({ response }: HttpContext) {
    return response.send('pagina 21')
  }

  async pagina22({ response }: HttpContext) {
    return response.send('pagina 22')
  }

  async pagina23({ response }: HttpContext) {
    return response.send('pagina 23')
  }

  async pagina24({ response }: HttpContext) {
    return response.send('pagina 24')
  }

  async pagina25({ response }: HttpContext) {
    return response.send('pagina 25')
  }

  async pagina26({ response }: HttpContext) {
    return response.send('pagina 26')
  }

  async pagina27({ response }: HttpContext) {
    return response.send('pagina 27')
  }
}
