import { Job } from '@adonisjs/queue'

import Assinante from '#models/assinante'

/** dispatched by nothing in the application: dead code, or a scheduler the analysis does not read — reported */
export default class EnviarBoletimJob extends Job {
  async execute() {
    const assinantes = await Assinante.query().where('ativo', true)
    for (const assinante of assinantes) await fetch(`mailto:${assinante.email}`)
  }
}
