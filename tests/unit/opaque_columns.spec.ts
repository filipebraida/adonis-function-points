import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import { appFixturePath } from '../helpers.js'

const warningsOf = async (app: string) =>
  (await analyze(appFixturePath(app))).count.confidence.warnings

/**
 * counting-decisions §8: a JSON column holding a form the user fills counts as
 * 1 DET, because the schema is runtime data.
 *
 * That trade was documented and nowhere else. The count reports an unresolved
 * call, a technical table, an unresolved mixin and a handler-less route — and
 * said nothing here, which made an opaque column the one known blind spot the
 * package kept to itself. Nobody reads a design document at the moment they
 * need it; the confidence block is read every run.
 */
test.group('opaque columns: the one blind spot the count used to hide', () => {
  test('an opaque column reached by a transaction is named', async ({ assert }) => {
    const warnings = await warningsOf('opaque_columns')

    assert.isTrue(warnings.some((w) => w.includes('Form.definition')))
    assert.isTrue(warnings.some((w) => w.includes('Form.filled')))
  })

  test('the type is shown, since it is why the column is unreadable', async ({ assert }) => {
    const warnings = await warningsOf('opaque_columns')

    assert.isTrue(warnings.some((w) => /Form\.definition \(object\)/.test(w)))
  })

  test('the advice points at the override that fixes it', async ({ assert }) => {
    const warnings = await warningsOf('opaque_columns')

    assert.isTrue(warnings.some((w) => /overrides/.test(w) && /§8/.test(w)))
  })

  test('how many transactions reach it, so the reader can judge', async ({ assert }) => {
    const warnings = await warningsOf('opaque_columns')

    assert.isTrue(warnings.some((w) => /1 transaction\(s\)/.test(w)))
  })

  /**
   * The noise control. An untouched blob changes no number, and warning about it
   * is what teaches people to stop reading the confidence block — which would
   * cost more than the silence this replaced.
   */
  test('an opaque column no transaction reaches is not named', async ({ assert }) => {
    const warnings = await warningsOf('opaque_columns')

    assert.isFalse(
      warnings.some((w) => w.includes('Setting.payload')),
      'nothing reaches Setting, so naming its blob would be noise'
    )
  })

  test('an ordinary column is never named', async ({ assert }) => {
    const warnings = await warningsOf('opaque_columns')

    assert.isFalse(warnings.some((w) => w.includes('Form.title')))
  })

  test('an application with no opaque column says nothing about them', async ({ assert }) => {
    const warnings = await warningsOf('minimal_flat')

    assert.isFalse(warnings.some((w) => /opaque column/.test(w)))
  })
})
