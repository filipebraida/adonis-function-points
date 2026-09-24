import { DateTime } from 'luxon'

import Note from '#models/note'
import AuditService from '#services/audit_service'
import { env } from '#start/env'

export default class NotesController {
  private names = new Map<number, string>()
  private audit = new AuditService()

  /**
   * The same shapes arrive through the constructor. A `Map` handed in this way
   * is how a transformer usually receives its lookups, and reading only class
   * properties missed every one of them.
   */
  constructor(
    private lookups = new Map<number, string>(),
    private logger = { error: (_m: string) => {} }
  ) {}

  /**
   * One real data access, surrounded by calls that cannot be data:
   * a framework service, luxon, an array method and a Map.
   */
  async store({ request }: { request: { input: (key: string) => string } }) {
    const note = await Note.create({ body: request.input('body') })

    const prefix = env.get('APP_NAME')
    const stamp = DateTime.now().toISO()
    const tags = ['a', 'b'].includes(prefix)
    this.names.get(note.id)
    this.lookups.get(note.id)
    this.logger?.error('done')

    // the OUTER call here is `catch`, a Promise method: the reported expression
    // is the whole chain, so the method seen is not `create`
    await Note.create({ body: 'second' }).catch(() => undefined)

    return { note, stamp, tags }
  }

  /**
   * The control for this fixture: a call on an application symbol that no
   * strategy can follow. Silencing it would be the defect the filter exists to
   * avoid, so it has to keep appearing in the coverage report.
   */
  async archive() {
    const note = await Note.findOrFail(1)
    await this.audit.record(note)
  }
}
