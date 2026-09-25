import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import { appFixturePath } from '../helpers.js'

const count = async () => {
  const analysis = await analyze(appFixturePath('request_input'))
  return analysis.count
}

/**
 * §7.2 asks whether a user-recognisable field crosses the boundary, not how it
 * was declared. Input DETs came only from VineJS, so a transaction reading four
 * fields off the request counted one — the floor of its complexity band.
 *
 * The distinction this fixture exists to hold: a transaction that reads nothing
 * is not the same as one whose reads could not be read. Two earlier versions of
 * the warning conflated them and named routes with nothing wrong with them.
 */
test.group('input DETs: read from the request, not only from a validator', () => {
  test('`request.input` and `request.only` are DETs', async ({ assert }) => {
    const { functions } = await count()
    const store = functions.find((f) => f.name === 'POST /tickets')!

    assert.equal(store.det, 4)
    assert.deepEqual(store.rationale.detSources, [
      'request:body',
      'request:channel',
      'request:priority',
      'request:subject',
    ])
  })

  test('a workflow trigger keeps its single route-parameter DET', async ({ assert }) => {
    const { functions } = await count()
    const close = functions.find((f) => f.name === 'POST /tickets/:param/close')!

    assert.equal(close.det, 1)
    assert.deepEqual(close.rationale.detSources, ['param::id'])
  })

  test('a trigger is not reported as a blind spot', async ({ assert }) => {
    const { confidence } = await count()
    const warnings = confidence.warnings.join('\n')

    assert.notInclude(
      warnings,
      '/close',
      'it never touches the request: there is nothing to declare and nothing to warn about'
    )
  })

  test('`request.all()` is reported, because it enumerates nothing', async ({ assert }) => {
    const { confidence } = await count()
    const warnings = confidence.warnings.join('\n')

    assert.include(warnings, 'POST /tickets/import')
    assert.include(warnings, 'UNDERSTATES')
  })

  /**
   * The rule that keeps this from inflating anything: where a validator and a
   * direct read name the same field, it is one DET. `detOf` deduplicates by field
   * name, and the validator keeps the provenance because it is the better one to
   * print.
   */
  test('a field declared twice is counted once', async ({ assert }) => {
    const vazquez = await analyze(appFixturePath('vazquez'))
    const store = vazquez.count.functions.find((f) => f.name === 'POST /apontamentos')!

    assert.equal(store.det, store.rationale.detSources.length)
    assert.isTrue(store.rationale.detSources.every((source) => !source.startsWith('request:')))
  })
})
