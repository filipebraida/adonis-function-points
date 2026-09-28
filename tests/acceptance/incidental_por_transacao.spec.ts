import { test } from '@japa/runner'

import { incidentalWrites } from '../../src/inventory/resolvers/index.js'
import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * A WRITE INCIDENTAL IN ONE TRANSACTION AND THE POINT OF ANOTHER — plan 0.15 §B
 *
 * A reviewing team hit it twice: remembering the organisation when a page opens, and when
 * the user switches; polling a verification when its status is read, and when it is asked
 * for. The CPM classifies each elementary process by its own intent. Reference first:
 * `fixtures/apps/incidental_por_transacao/REFERENCE.md`.
 */
const root = appFixturePath('incidental_por_transacao')
const typeOf = (count: CountResult, name: string) =>
  count.functions.find((f) => f.name === name)?.type

test.group('incidental writes, per transaction', () => {
  test('without a declaration: both EIs, 23 FP', async ({ assert }) => {
    const { count } = await analyze(root)
    assert.equal(typeOf(count, 'GET /pedidos/:param'), 'EI')
    assert.equal(typeOf(count, 'POST /organizacao/trocar'), 'EI')
    assert.equal(count.totals.unadjusted, 23)
  })

  test('declared everywhere (0.14): the switch turns into an EO — the error that asked for `in`', async ({
    assert,
  }) => {
    const { count } = await analyze(root, {
      resolvers: {
        call: [incidentalWrites({ name: 'organizacao', methods: ['lembrarOrganizacao'] })],
      },
    })
    assert.equal(typeOf(count, 'GET /pedidos/:param'), 'EO')
    assert.equal(typeOf(count, 'POST /organizacao/trocar'), 'EO')
    assert.equal(count.totals.unadjusted, 25)
  })

  test('declared `in` the page: the page is an EO, the switch stays an EI, 24 FP', async ({
    assert,
  }) => {
    const { count } = await analyze(root, {
      resolvers: {
        call: [
          incidentalWrites({
            name: 'organizacao',
            methods: ['lembrarOrganizacao'],
            in: ['GET /pedidos/:param'],
          }),
        ],
      },
    })
    assert.equal(typeOf(count, 'GET /pedidos/:param'), 'EO')
    assert.equal(typeOf(count, 'POST /organizacao/trocar'), 'EI')
    assert.equal(typeOf(count, 'Preferencia'), 'ILF')
    assert.equal(count.totals.unadjusted, 24)
  })

  test('an identity in `in` no transaction has is reported', async ({ assert }) => {
    const { count } = await analyze(root, {
      resolvers: {
        call: [
          incidentalWrites({
            name: 'organizacao',
            methods: ['lembrarOrganizacao'],
            in: ['GET /pedidos'],
          }),
        ],
      },
    })
    assert.include(
      count.confidence.warnings,
      `incidentalWrites("organizacao") in: 'GET /pedidos' matched no transaction: it had no effect`
    )
  })
})
