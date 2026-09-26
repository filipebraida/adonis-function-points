import { Job } from '@adonisjs/queue'

import Noticia from '#models/noticia'

/** scheduled in `start/scheduler.ts`, reached by no transaction: a process nobody counts — reported */
export default class PodarNoticiasJob extends Job {
  async execute() {
    await Noticia.query().where('publicada_em', '<', '2020-01-01').delete()
  }
}
