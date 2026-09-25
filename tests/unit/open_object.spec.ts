import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectJsonSchemas } from '../../src/inventory/sources/json_schemas.js'
import { analyze } from '../../src/pipeline.js'
import { appFixturePath } from '../helpers.js'

const ROOT = appFixturePath('open_object')
const ei = async (options = {}) => {
  const { count } = await analyze(ROOT, options)
  return { fn: count.functions.find((f) => f.name === 'POST /forms')!, count }
}

/**
 * `answers: vine.object({}).allowUnknownProperties()` declares a field whose own
 * fields live in data. The walk descended into the empty literal, found nothing,
 * and never pushed `answers` either — so the field counted ZERO, while an opaque
 * JSON column in the same position counts 1.
 *
 * Found by installing the package in a production application: the route that
 * saves the main document was not counting its form at all, and nothing in the
 * report said so.
 */
test.group('open input object: a floor, never a zero', () => {
  test('an open `vine.object` counts one DET', async ({ assert }) => {
    const { fn } = await ei()

    assert.equal(fn.det, 3, 'title, initial, and the open object')
    assert.include(fn.rationale.detSources, 'validator:createFormValidator.answers (opaque)')
  })

  test('it is reported, because the number is a floor', async ({ assert }) => {
    const { count } = await ei()
    const warning = count.confidence.warnings.find((w) => w.includes('open input object'))

    assert.exists(warning, 'the opaque-column warning names stores; this side had none')
    assert.include(
      count.confidence.warnings.join('\n'),
      'POST /forms — createFormValidator.answers'
    )
  })

  test('the opaque column on the same field is marked too', async ({ assert }) => {
    const { count } = await ei()
    const store = count.functions.find((f) => f.name === 'Form')!

    assert.include(store.rationale.detSources, 'ast:forms.answers (opaque)')
  })
})

/**
 * The override replaces the opaque placeholder. It used to assume there was one
 * and that it was worth 1 — wrong twice: an open `vine.object` counted zero, so
 * the subtraction removed a field the analysis had read correctly.
 */
test.group('detFromSchema: replace the placeholder, do not assume it', () => {
  const override = {
    overrides: { 'POST /forms': { detFromSchema: 'intakeSchema', reason: 'the form is data' } },
  }

  test('the schema replaces exactly the opaque DET', async ({ assert }) => {
    const { fn } = await ei(override)

    // 3 read - 1 placeholder + 6 declared
    assert.equal(fn.det, 8)
    assert.equal(
      fn.rationale.overrides![0].by,
      'config:overrides.POST /forms (from intakeSchema: 6 fields)'
    )
  })

  /**
   * `database/` is excluded from the application roots so a test factory's writes
   * never become counted functions. But `make:seeder` puts seeders there, which is
   * where a form's schema lives — and naming one reported "not declared anywhere
   * in the code", which is the very case the override exists for.
   */
  test('a schema declared in a seeder is found', async ({ assert }) => {
    const app = await discoverApp(ROOT)
    const schemas = collectJsonSchemas(app)

    assert.isFalse(
      app.scanRoots.some((root) => root.endsWith('/database')),
      'still not an application root: reading a literal counts nothing, a write would'
    )
    assert.equal(schemas.get('intakeSchema')?.fields, 6)
  })

  test('an opaque column is replaced the same way', async ({ assert }) => {
    const { count } = await analyze(ROOT, {
      overrides: { Form: { detFromSchema: 'intakeSchema', reason: 'the column is the form' } },
    })

    const form = count.functions.find((f) => f.name === 'Form')!

    // 2 read - 1 placeholder + 6 declared
    assert.equal(form.det, 7)
  })

  /**
   * The subtraction used to happen regardless, so an override aimed at the wrong
   * function quietly removed one of its DETs. Now the fields are added and the
   * misdirection is reported: a declaration that does nothing is the failure this
   * whole mechanism is meant to avoid.
   */
  test('an override on a function with NO opaque DET adds, and warns', async ({ assert }) => {
    const before = await analyze(ROOT)
    const after = await analyze(ROOT, {
      overrides: { 'POST /notes': { detFromSchema: 'intakeSchema', reason: 'wrong target' } },
    })

    const plain = before.count.functions.find((f) => f.name === 'POST /notes')!

    assert.isEmpty(
      plain.rationale.detSources.filter((source) => source.endsWith('(opaque)')),
      'the control: nothing here is a floor'
    )
    assert.equal(
      after.count.functions.find((f) => f.name === 'POST /notes')!.det,
      plain.det + 6,
      'nothing was replaced, so nothing is subtracted'
    )
    assert.isTrue(
      after.count.confidence.warnings.some((w) =>
        w.includes('no opaque DET for it to stand in for')
      )
    )
  })
})
