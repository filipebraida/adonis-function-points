import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectJsonSchemas } from '../../src/inventory/sources/json_schemas.js'
import { analyze } from '../../src/pipeline.js'
import { renderExplain } from '../../src/reporters/table.js'
import { appFixturePath } from '../helpers.js'

const schemas = async () => collectJsonSchemas(await discoverApp(appFixturePath('opaque_columns')))

const REASON = 'form driven by a JSON Schema'

/**
 * counting-decisions §8 says a JSON column counts as 1 DET because the schema is
 * runtime data. That is true of the row and false of the literal that seeded it:
 * when the schema is an object literal in the code, ts-morph reads it, and the
 * §7 leaf rules apply unchanged.
 */
test.group('json schemas: read from the code, counted by §7', () => {
  test('a schema literal is found by shape, not by name', async ({ assert }) => {
    const found = await schemas()

    assert.equal(found.size, 1)
    assert.isTrue(found.has('applicationSchema'))
  })

  test('the §7 leaf rules are applied', async ({ assert }) => {
    const found = await schemas()
    const schema = found.get('applicationSchema')!

    assert.deepEqual(schema.leaves, [
      'name', // scalar: 1
      'address.street', // nested object: leaves counted individually
      'address.city',
      'dependents.name', // array of object: leaves, counted once
      'dependents.age',
      'tags', // array of scalar: 1, a repeating group
    ])
    assert.equal(schema.fields, 6)
  })

  test('it carries provenance, so the number is traceable to a line', async ({ assert }) => {
    const found = await schemas()
    const schema = found.get('applicationSchema')!

    assert.match(schema.provenance.file, /seeders[/\\]form_seeder\.ts$/)
    assert.isAbove(schema.provenance.line ?? 0, 0)
    assert.equal(schema.provenance.by, 'json-schema')
  })
})

/**
 * Why a schema rather than a declared number: a frozen count goes stale the moment
 * someone adds a field, and `fp:diff` would then report no change for real
 * functional growth — undercounting silently and progressively, which is worse
 * than undercounting once.
 *
 * The declaration is keyed by the COLUMN (`Form.definition`), not by a function:
 * a schema is a fact about the column, and it reaches every function that carries
 * it (counting-decisions §9).
 */
test.group('opaque schemas: the number stays in the code', () => {
  const run = (opaque: Record<string, { schemas?: string; reason: string }>) =>
    analyze(appFixturePath('opaque_columns'), { opaque })

  test('the schema replaces the single DET the opaque column contributed', async ({ assert }) => {
    const plain = await analyze(appFixturePath('opaque_columns'))
    const declared = await run({
      'Form.definition': { schemas: 'applicationSchema', reason: REASON },
    })

    const before = plain.count.functions.find((f) => f.name === 'Form')!
    const after = declared.count.functions.find((f) => f.name === 'Form')!

    assert.equal(after.det, before.det - 1 + 6)
  })

  test('the report names the schema and its field count', async ({ assert }) => {
    const { count } = await run({
      'Form.definition': { schemas: 'applicationSchema', reason: REASON },
    })
    const text = renderExplain(count.functions.find((f) => f.name === 'Form')!)

    assert.include(text, 'from applicationSchema: 6 fields')
    assert.include(text, 'ast:forms.definition → applicationSchema (6 fields)')
    assert.include(text, REASON)
  })

  test('only the DET line is marked, not the RET', async ({ assert }) => {
    const { count } = await run({
      'Form.definition': { schemas: 'applicationSchema', reason: REASON },
    })
    const text = renderExplain(count.functions.find((f) => f.name === 'Form')!)

    const det = text.split('\n').find((l) => l.startsWith('DET ='))!
    const ret = text.split('\n').find((l) => l.startsWith('RET ='))!

    assert.include(det, 'declared by override')
    assert.notInclude(ret, 'declared by override', 'RET was not declared')
  })

  /** the table's name is what `fp:explain` prints, so a person may copy that spelling */
  test('the column may be keyed by the physical table as well', async ({ assert }) => {
    const byModel = await run({
      'Form.definition': { schemas: 'applicationSchema', reason: REASON },
    })
    const byTable = await run({
      'forms.definition': { schemas: 'applicationSchema', reason: REASON },
    })

    assert.equal(
      byTable.count.functions.find((f) => f.name === 'Form')!.det,
      byModel.count.functions.find((f) => f.name === 'Form')!.det
    )
  })

  /**
   * A renamed or moved schema breaks the mapping. Counting on silently would be
   * the same silent staleness this exists to avoid.
   */
  test('a schema name that matches nothing warns and leaves the count alone', async ({
    assert,
  }) => {
    const plain = await analyze(appFixturePath('opaque_columns'))
    const { count } = await run({ 'Form.definition': { schemas: 'goneSchema', reason: REASON } })

    assert.equal(
      count.functions.find((f) => f.name === 'Form')!.det,
      plain.count.functions.find((f) => f.name === 'Form')!.det
    )
    assert.isTrue(count.confidence.warnings.some((w) => /goneSchema/.test(w)))
  })
})
