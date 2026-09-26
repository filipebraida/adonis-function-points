import { test } from '@japa/runner'
import { Node } from 'ts-morph'

import type { CallResolver } from '../../src/inventory/resolvers/types.js'

import { analyze } from '../../src/pipeline.js'
import { appFixturePath } from '../helpers.js'

/**
 * AFP §6.5.4 separates ILF from EIF by who MAINTAINS the store, and that
 * question is about the application, not about its routes.
 *
 * The graph is walked from HTTP entry points, so a table written only by a job,
 * a scheduler or a seeder looked read-only and came out as somebody else's
 * table — which both undercounts and misdescribes the system. Maintenance is
 * therefore decided over the whole project, while the transactions that are
 * counted still come from entry points alone.
 */
test.group('ILF vs EIF: maintenance is a property of the application', () => {
  test('a store written only by a job is an ILF', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('job_maintained'))

    const report = count.functions.find((f) => f.name === 'Report')
    assert.exists(report, 'the store is read by a route, so it is used')
    assert.equal(report!.type, 'ILF', 'this application maintains `reports` — through a job')
  })

  test('a store this application only reads is still an EIF', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('job_maintained'))

    const rate = count.functions.find((f) => f.name === 'ExchangeRate')
    assert.equal(
      rate!.type,
      'EIF',
      'no write anywhere in the project: the control that keeps the rule from collapsing into "everything is an ILF"'
    )
  })

  test('the job itself is not an entry point', async ({ assert }) => {
    const { count, inventory } = await analyze(appFixturePath('job_maintained'))

    /**
     * Maintenance is read project-wide; transactions are not. A job reached by
     * a scheduler crosses no boundary the user can see, and counting it would
     * invent an elementary process.
     */
    assert.isEmpty(
      inventory.entryPoints.filter((e) => (e.name ?? '').includes('Refresh')),
      'nobody dispatches it: a scheduled job is an entry point of its own, and out of scope'
    )
    assert.deepEqual(
      count.functions
        .filter((f) => f.type === 'EI' || f.type === 'EO' || f.type === 'EQ')
        .map((f) => f.name)
        .sort(),
      [
        'GET /reports',
        'GET /reports/:param',
        'POST /reports/:param/lines',
        'POST /reports/:param/notify',
      ],
      'only the routes — the job the scheduler runs invents no elementary process'
    )
  })
})

/**
 * The execution method of a job has no single name across queue packages, and
 * the dispatch is followed as part of the SAME transaction: the user clicks and
 * the effect happens.
 */
test.group('job dispatch: the write is in the execution method', () => {
  test('a dispatch reaching `process` counts as a transaction', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('job_maintained'))

    const notify = count.functions.find((f) => f.name === 'POST /reports/:param/notify')
    assert.exists(notify, 'the route writes — through the job it dispatches')
    assert.equal(notify!.type, 'EI')
  })

  test('the dispatch is not reported as an unknown', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('job_maintained'))

    assert.equal(
      count.confidence.unresolvedCalls,
      0,
      'falling back to `dispatch` resolved a file and then no body: both a false gap and a lost write'
    )
  })
})

/**
 * `report.related('lines').create(…)` — the relation is the SUBJECT of the write,
 * not a table read along the way. Every relation access was treated as a read, so
 * a table written exclusively that way came out as an EIF: a production
 * application reported one it was sure it maintained.
 */
test.group('relations: a write through one maintains the related table', () => {
  /**
   * `ReportLine` is only ever reached through `Report`, so under §10 it is a RET of
   * `Report` rather than a data function of its own. The mechanism this group
   * exists for is unchanged and is checked with grouping off: nothing names the
   * table on the left of a write, and it is still maintained.
   */
  test('a store written only through a relation is an ILF', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('job_maintained'), {
      dataFunctions: { grouping: 'none' },
    })

    const line = count.functions.find((f) => f.name === 'ReportLine')
    assert.exists(line, 'nothing names it on the left of a write')
    assert.equal(line!.type, 'ILF')
  })

  /**
   * With the default grouping the same fact shows up on the transaction: the write
   * through the relation is what makes `POST /reports/:id/lines` an EI. Read as a
   * read, it would be an EO — and `Report` would still be an ILF through the job,
   * so the type of the transaction is the assertion with teeth.
   */
  test('the transaction writes through the relation, and the detail is a RET of its master', async ({
    assert,
  }) => {
    const { count } = await analyze(appFixturePath('job_maintained'))
    const addLine = count.functions.find((f) => f.name === 'POST /reports/:param/lines')!

    assert.equal(addLine.type, 'EI')
    assert.deepEqual(addLine.rationale.refSources, ['reaches:Report (via ReportLine)'])

    const report = count.functions.find((f) => f.name === 'Report')!
    assert.equal(report.refs, 2, 'Report + its lines')
    assert.include(report.rationale.detSources, 'ast:report_lines.label')
    assert.isUndefined(count.functions.find((f) => f.name === 'ReportLine'))
  })

  /**
   * The control, and the reason this cannot be "any relation access writes":
   * `preload` and `load` hand back the parent, so what follows acts on the parent.
   * Only `related` hands back the relation's own builder.
   */
  test('a relation reached by preload is still only read', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'))

    /**
     * `Author` is only ever preloaded in this fixture — nothing writes it. So EIF
     * is the right answer, and it is the sharpest possible control: if `preload`
     * counted as a relation write, this would flip to ILF and nothing else in the
     * suite would notice.
     */
    assert.equal(count.functions.find((f) => f.name === 'Author')!.type, 'EIF')
    assert.equal(count.functions.find((f) => f.name === 'Book')!.type, 'ILF')
  })
})

/**
 * §6.5.4 asks who maintains THIS store. Two different mistakes read it as something
 * else, and both made almost everything an ILF.
 */
test.group('maintenance is per store, and scaffolding does not maintain', () => {
  test('a table only the seed writes is not an ILF', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('job_maintained'))

    /**
     * The CPM puts data maintained by the development team at an EIF at most. The
     * project-wide pass read a seeder's inserts as the application maintaining the
     * table, and a domain-module layout puts `seeders/` and `tests/` inside `app/`,
     * where the filter on scan roots never looks.
     */
    assert.equal(count.functions.find((f) => f.name === 'Country')!.type, 'EIF')
  })

  test('a store a route writes is still an ILF', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('job_maintained'))

    /**
     * The control: excluding scaffolding must not exclude the application. The
     * factory under `app/tests/` is the only file that names `ReportLine` directly,
     * and it must count neither as maintenance nor as addressing the table — so
     * `ReportLine` folds into `Report` (§10) and the group is an ILF.
     */
    const report = count.functions.find((f) => f.name === 'Report')!
    assert.equal(report.type, 'ILF')
    assert.equal(report.refs, 2, 'ReportLine is its RET, not a data function of its own')
  })

  /**
   * `writes` is a property of the TRANSACTION — it decides EI against EO — and was
   * read as a property of every store the transaction touched. A reference table
   * merely READ by a route that writes something else became an ILF, which on a
   * production application left exactly one EIF in the whole count.
   */
  test('a store only READ by a writing transaction is not maintained', async ({ assert }) => {
    const { inventory, count } = await analyze(appFixturePath('job_maintained'))

    const index = inventory.entryPoints.find((e) => e.signature === '/reports')!
    const behavior = inventory.behaviors.find((b) => b.entryPointId === index.id)!

    assert.include(behavior.touches, 'Country', 'the transaction does reference it')
    assert.notInclude(behavior.writtenStores, 'Country', 'and does not write it')
    assert.equal(count.functions.find((f) => f.name === 'Country')!.type, 'EIF')
  })
})

/**
 * §6.5.3 decides EI against EO mechanically, which is deliberate — repeatability over
 * CPM fidelity — and misreads one shape: a screen that records the visit. The CPM asks
 * what the elementary process is PRIMARILY for, and for a `GET` that shows a record
 * while noting the visit, the answer is presentation.
 */
test.group('a technical write does not decide what a transaction is for', () => {
  const bookkeeping = {
    name: 'visit-bookkeeping',
    order: 1,
    resolve: () => [],
    technicalWrite(call: Parameters<NonNullable<CallResolver['technicalWrite']>>[0]) {
      const expression = call.getExpression()
      return Node.isPropertyAccessExpression(expression) && expression.getName() === 'recordVisit'
    },
  } satisfies CallResolver

  test('by default the write makes it an EI', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('job_maintained'))

    assert.equal(count.functions.find((f) => f.name === 'GET /reports/:param')!.type, 'EI')
  })

  test('declared technical, it is an EO', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('job_maintained'), {
      resolvers: { call: [bookkeeping] },
    })

    assert.equal(count.functions.find((f) => f.name === 'GET /reports/:param')!.type, 'EO')
  })

  /**
   * The one thing this must not do. The visit table really is written by this
   * application, so it stays an ILF and stays an FTR — only the transaction's
   * classification changes. A declaration that made the write disappear would be
   * `ignores`, and would be wrong.
   */
  test('the store it writes is still maintained', async ({ assert }) => {
    const { count, inventory } = await analyze(appFixturePath('job_maintained'), {
      resolvers: { call: [bookkeeping] },
    })

    assert.equal(count.functions.find((f) => f.name === 'Visit')!.type, 'ILF')

    const show = inventory.entryPoints.find((e) => e.signature === '/reports/:id')!
    const behavior = inventory.behaviors.find((b) => b.entryPointId === show.id)!
    assert.include(behavior.writtenStores, 'Visit', 'the write is recorded, just not primary')
  })
})
