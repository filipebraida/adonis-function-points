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

/**
 * `vine.object({}).merge(vine.group([vine.group.if(p, {…})]))` — the branches are
 * mutually exclusive at runtime and the transaction can carry any of them, so §7.2
 * counts the fields the elementary process handles: their union.
 *
 * Read from the first object literal alone, the whole validator looked like an open
 * object. The report then said the fields were data when they are plainly in the
 * code, and `detFromSchema` could not correct it, because a group is not a JSON
 * Schema.
 */
test.group('conditional groups: the union of the branches', () => {
  test('every branch field counts', async ({ assert }) => {
    const { count } = await analyze(ROOT)
    const pay = count.functions.find((f) => f.name === 'POST /pay')!

    assert.deepEqual(pay.rationale.detSources, [
      'validator:payValidator.cardNumber',
      'validator:payValidator.cvv',
      'validator:payValidator.iban',
      'validator:payValidator.shared',
    ])
  })

  test('a field in two branches is one DET', async ({ assert }) => {
    const { count } = await analyze(ROOT)
    const pay = count.functions.find((f) => f.name === 'POST /pay')!

    assert.equal(pay.det, 4, '5 declarations, 4 fields the user recognises')
  })

  test('the validator is no longer reported as an open object', async ({ assert }) => {
    const { count } = await analyze(ROOT)

    assert.notInclude(
      count.confidence.warnings.join('\n'),
      'payValidator',
      'the fields are code; saying otherwise is a false blind spot'
    )
  })
})

/**
 * An ILF's DETs are the fields the user recognises in the file, and an application
 * with one schema per template recognises all of them. Pointing at the largest and
 * justifying it in `reason` gives the same answer only while they land in the same
 * complexity band — reasoning the configuration should not have to carry.
 */
test.group('detFromSchema: several schemas, unioned', () => {
  const over = (detFromSchema: string | string[]) => ({
    overrides: { 'POST /forms': { detFromSchema, reason: 'one schema per template' } },
  })

  test('the union is over leaf paths, not a sum of counts', async ({ assert }) => {
    const one = await analyze(ROOT, over('intakeSchema'))
    const both = await analyze(ROOT, over(['intakeSchema', 'reviewSchema']))

    // 6 fields, and 4 more of which 2 are shared
    assert.equal(one.count.functions.find((f) => f.name === 'POST /forms')!.det, 8)
    assert.equal(both.count.functions.find((f) => f.name === 'POST /forms')!.det, 10)
  })

  test('a name that matches nothing warns and contributes nothing', async ({ assert }) => {
    const { count } = await analyze(ROOT, over(['intakeSchema', 'absent']))
    const form = count.functions.find((f) => f.name === 'POST /forms')!

    assert.equal(form.det, 8, 'the schemas that resolved still count')
    assert.include(
      form.rationale.overrides![0].by,
      'from intakeSchema:',
      'naming a schema that contributed nothing would mislead'
    )
    assert.isTrue(count.confidence.warnings.some((w) => w.includes('"absent"')))
  })
})

/**
 * 1 DET for an opaque column is a floor, and `fp:count` says so on every run. Some
 * of those columns really are one field — a copy, a checksum, a bag of metadata —
 * and there was no way to record that someone had looked, so the warning fired
 * forever. A warning that cannot be answered is one the team learns to scroll past,
 * which costs more than the warning reports.
 */
test.group('opaqueReviewed: answering a warning that is correct', () => {
  const reviewed = {
    overrides: { Form: { opaqueReviewed: ['answers'], reason: 'a copy of the form; one field' } },
  }

  test('the warning becomes a record instead of a nag', async ({ assert }) => {
    const before = await analyze(ROOT)
    const after = await analyze(ROOT, reviewed)

    assert.isTrue(
      before.count.confidence.warnings.some((w) => w.includes('opaque column(s), each'))
    )
    assert.isTrue(
      after.count.confidence.warnings.some((w) => w.includes('declared reviewed, left at 1 DET')),
      'the fact is recorded, not erased'
    )
  })

  test('it moves no number', async ({ assert }) => {
    const before = await analyze(ROOT)
    const after = await analyze(ROOT, reviewed)

    assert.equal(after.count.totals.unadjusted, before.count.totals.unadjusted)
    assert.equal(
      after.count.functions.find((f) => f.name === 'Form')!.det,
      before.count.functions.find((f) => f.name === 'Form')!.det
    )
  })

  /**
   * `fp:count` prints what share of the total came from a person, and that line is
   * why the whole mechanism is acceptable. An entry declaring no number read as
   * "1 function, 7 FP, 35% declared by override", misrepresenting the one number
   * that exists to keep this honest.
   */
  test('a review is not a declared number', async ({ assert }) => {
    const { count } = await analyze(ROOT, reviewed)

    assert.isUndefined(count.functions.find((f) => f.name === 'Form')!.rationale.overrides)
  })
})
