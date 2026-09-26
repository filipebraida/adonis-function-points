import { test } from '@japa/runner'
import { Project, SyntaxKind } from 'ts-morph'

import { ignoreCalls, resolveCall } from '../../../src/inventory/resolvers/index.js'
import type { ResolverContext } from '../../../src/inventory/resolvers/types.js'

/**
 * Read from a real configuration, every "this call reaches no data" strategy was
 * the same eight lines: a helper to read the method name off the ts-morph node
 * (the application does not depend on ts-morph), `resolve: () => []`, and one
 * comparison. The factory keeps what the design wants — a NAMED strategy whose
 * volume the report still prints — and drops the ceremony.
 */
const callsOf = (code: string) =>
  new Project({ useInMemoryFileSystem: true })
    .createSourceFile('x.ts', code)
    .getDescendantsOfKind(SyntaxKind.CallExpression)

const ctx = {} as ResolverContext

test.group('resolver: ignoreCalls', () => {
  test('by method name, whoever the receiver is', async ({ assert }) => {
    const variants = ignoreCalls({ name: 'attachment-variants', methods: ['getVariant', 'getUrl'] })
    const [a, b, c] = callsOf('x.getVariant(); this.file.getUrl(); repo.find(1)')

    assert.isTrue(variants.ignores!(a, ctx))
    assert.isTrue(variants.ignores!(b, ctx))
    assert.isFalse(variants.ignores!(c, ctx), 'a name not in the list is not touched')
  })

  test('by a pattern over the callee', async ({ assert }) => {
    const authz = ignoreCalls({ name: 'authz-can', matching: /\bauthz\.can$/ })
    const [a, b] = callsOf('await authz.can(u, "x"); await this.authz.cannot(u)')

    assert.isTrue(authz.ignores!(a, ctx))
    assert.isFalse(authz.ignores!(b, ctx))
  })

  test('it follows nothing, and is asked first', async ({ assert }) => {
    const strategy = ignoreCalls({ name: 'noop', methods: ['ping'] })

    const [ping, pong] = callsOf('a.ping(); b.pong()')

    assert.deepEqual(strategy.resolve(ping, ctx), [], 'it follows nothing')
    assert.equal(strategy.order, 1, 'before every built-in')
    assert.deepEqual(
      resolveCall(ping, ctx, [strategy]),
      { by: 'noop', refs: [] },
      'claimed as data-free, under its name: the volume stays reportable'
    )
    assert.isNull(
      resolveCall(pong, ctx, [strategy]),
      'a call it does not name is left to the others'
    )
  })

  /** a strategy that says nothing about what it ignores would silence nothing and look configured */
  test('refuses a strategy with neither methods nor a pattern', async ({ assert }) => {
    assert.throws(() => ignoreCalls({ name: 'empty' }), /say what it ignores/)
  })
})
