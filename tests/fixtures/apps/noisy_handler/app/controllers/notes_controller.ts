import { DateTime } from 'luxon'

import { LABELS } from '#enums/labels'
import Note from '#models/note'
import AuditService from '#services/audit_service'
import { env } from '#start/env'

type Rule = { active: boolean }

export default class NotesController {
  private names = new Map<number, string>()
  private audit = new AuditService()

  /**
   * A list whose type says nothing about being native and that has no
   * initializer to read. `this.rules` therefore reaches the coverage report,
   * and the only thing separating `some((r) => …)` from a repository's `some`
   * is the callback.
   */
  declare rules: Rule[]

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
  /**
   * Iteration over a list already in memory, and a call on the RESULT of
   * another call. Neither can reach a data store; the inner `enqueue` can, and
   * it stays reported.
   */
  async refresh() {
    const active = this.rules.some((rule) => rule.active)
    const mapped = this.rules.map((rule) => rule.active)
    const when = new Date().toISOString()
    const labels = LABELS.map((label) => label.toUpperCase())

    await this.audit.enqueue(active).waitResult()

    return { mapped, when, labels }
  }

  async archive() {
    const note = await Note.findOrFail(1)
    await this.audit.record(note)
  }
}
