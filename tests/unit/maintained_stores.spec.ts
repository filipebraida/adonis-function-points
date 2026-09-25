import { test } from '@japa/runner'

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
      ['GET /reports', 'POST /reports/:param/notify'],
      'only the two routes — the job the scheduler runs invents no elementary process'
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
