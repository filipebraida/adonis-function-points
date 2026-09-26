import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * THE VALUE OF A TRANSACTION CALLBACK IS WHAT IT RETURNS — plan 0.10 §B,
 * counting-decisions §3
 *
 * `const { verificacao } = await db.transaction(async (trx) => { … return { verificacao } })`,
 * then `verificacao.save()`: the write was an unreadable receiver. The reference
 * (`fixtures/apps/transacao_valor/REFERENCE.md`) was written first; afp@1.8.0 printed
 * the same 18 FP with the wrong gap listed.
 */
const REFERENCE = {
  total: 18,
  functions: {
    'Verificacao': { type: 'ILF', det: 3, refs: 1, fp: 7 },
    'Pessoa': { type: 'EIF', det: 1, refs: 1, fp: 5 },
    'POST /verificacoes': { type: 'EI', det: 1, refs: 2, fp: 3 },
    'POST /verificacoes/:param/anular': { type: 'EI', det: 1, refs: 1, fp: 3 },
  },
} as const

let cached: Awaited<ReturnType<typeof analyze>> | undefined
const analyzed = async () => {
  if (!cached) cached = await analyze(appFixturePath('transacao_valor'))
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('transaction value: the reference, function by function', () => {
  test('every function matches the reference in type, DET, FTR and points', async ({ assert }) => {
    const { count: result } = await analyzed()
    for (const [name, expected] of Object.entries(REFERENCE.functions)) {
      const counted = fn(result, name)
      assert.equal(counted.type, expected.type, `${name}: type`)
      assert.equal(counted.det, expected.det, `${name}: DET`)
      assert.equal(counted.refs, expected.refs, `${name}: FTR/RET`)
      assert.equal(counted.points, expected.fp, `${name}: FP`)
    }
    assert.equal(result.totals.unadjusted, REFERENCE.total)
    // a raw-query row reaches no store the graph can see: no transaction to identify (§6.5.3)
    assert.isUndefined(
      result.functions.find((f) => f.name === 'POST /verificacoes/:param/carimbar')
    )
  })
})

test.group('transaction value: what is bound, what is reported', () => {
  /** two returns, the same store under `verificacao`: the destructured name is bound, the write is read */
  test("a name destructured from the callback's returned literal is the store every return names", async ({
    assert,
  }) => {
    const { inventory } = await analyzed()
    const store = inventory.behaviors.find((b) => b.entryPointId === 'POST /verificacoes')!
    assert.lengthOf(store.unresolved, 0, 'verificacao.save is a write on Verificacao now')
    assert.includeMembers(store.writtenStores, ['Verificacao'])
  })

  /** a returned number binds nothing and is not reported */
  test('a returned number is not rows', async ({ assert }) => {
    const { inventory } = await analyzed()
    const anular = inventory.behaviors.find(
      (b) => b.entryPointId === 'POST /verificacoes/:id/anular'
    )!
    assert.lengthOf(anular.unresolved, 0)
  })

  /**
   * `db` is a package import, but `db.transaction(cb)` hands back what the callback returns:
   * a raw-query row nobody can type. The write on it is reported — the 0.8 exclusion of
   * package-built values was too wide, and this is the case that narrowed it.
   */
  test('a write on a value a callback returned unreadably is reported, package root or not', async ({
    assert,
  }) => {
    const { count: result, inventory } = await analyzed()
    // afp@1.10.0 reads the raw query too: its table has no model, and that is a gap of its own
    assert.equal(result.confidence.unresolvedCalls, 2)
    const site = inventory.unresolved.find((u) => u.expression === 'alvo.save')!
    assert.include(site.reason, 'write on a receiver whose type the analysis cannot read')
    const raw = inventory.unresolved.find((u) => u.expression.startsWith('trx.rawQuery'))!
    assert.include(raw.reason, 'raw query on a table no model declares: carimbos')
  })
})
