import { test } from '@japa/runner'

import { analyze } from '../../src/pipeline.js'
import type { CountResult } from '../../src/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * A LISTENER WRITTEN INLINE IS A LISTENER; A STRING EVENT IS AN EVENT — plan 0.9 §C,
 * counting-decisions §9
 *
 * An application that binds every listener as `emitter.on('order:closed', async
 * function ({ orderId }) { … })` had none of them followed: the collector read only
 * `emitter.on(EventClass, [ListenerClass])`. The reference
 * (`fixtures/apps/eventos_inline/REFERENCE.md`) was written first; afp@1.7.0 said 13.
 */
const REFERENCE = {
  total: 27,
  functions: {
    'Pedido': { type: 'ILF', det: 2, refs: 1, fp: 7 },
    'Notificacao': { type: 'ILF', det: 2, refs: 1, fp: 7 },
    'Auditoria': { type: 'ILF', det: 2, refs: 1, fp: 7 },
    'POST /pedidos': { type: 'EI', det: 1, refs: 2, fp: 3 },
    'DELETE /pedidos/:param': { type: 'EI', det: 1, refs: 2, fp: 3 },
  },
} as const

let cached: Awaited<ReturnType<typeof analyze>> | undefined
const analyzed = async () => {
  if (!cached) cached = await analyze(appFixturePath('eventos_inline'))
  return cached
}

const fn = (result: CountResult, name: string) => {
  const found = result.functions.find((f) => f.name === name)
  if (!found) throw new Error(`"${name}" was not counted`)
  return found
}

test.group('inline listeners: the reference, function by function', () => {
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
    assert.equal(result.confidence.unresolvedCalls, 0)
  })
})

test.group('inline listeners: what is followed', () => {
  /** `emitter.emit('pedido:criado', …)` → `emitter.on('pedido:criado', async function …)` → the job → its write */
  test('a string event reaches its inline listener, and the job it dispatches', async ({
    assert,
  }) => {
    const { count: result, inventory } = await analyzed()
    assert.includeMembers(fn(result, 'POST /pedidos').rationale.refSources, [
      'reaches:Notificacao',
      'reaches:Pedido',
    ])
    const behavior = inventory.behaviors.find((b) => b.entryPointId === 'POST /pedidos')!
    assert.isTrue(
      behavior.trace.some((t) => t.file.endsWith('start/events.ts') && t.by === 'event-dispatch'),
      'the inline listener is on the trace'
    )
    assert.isTrue(behavior.trace.some((t) => t.file.endsWith('notificar_pedido_job.ts')))
  })

  /** `PedidoCancelado.dispatch(id)` → `emitter.on(PedidoCancelado, async (event) => …)` → the write */
  test('a class event reaches its inline arrow listener', async ({ assert }) => {
    const { count: result } = await analyzed()
    assert.includeMembers(fn(result, 'DELETE /pedidos/:param').rationale.refSources, [
      'reaches:Auditoria',
      'reaches:Pedido',
    ])
  })

  /** the job is dispatched by a listener a transaction reaches: nothing to report */
  test('no job is reported as reached by no transaction', async ({ assert }) => {
    const { count: result } = await analyzed()
    assert.notInclude(result.confidence.warnings.join('\n'), 'reached by no transaction')
  })
})
