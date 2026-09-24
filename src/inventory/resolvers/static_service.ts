import { SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * "Static service" pattern: a class method called without instantiating.
 *
 *     await UserService.create(payload)
 *     await OrderService.finalize(order)
 *
 * Careful: `Order.findByOrFail(...)` has exactly the same syntactic shape. The
 * difference is semantic — a model is a data store, not a body to walk into,
 * and the `PersistenceDetector` handles it. Hence this resolver depends on
 * `ctx.dataStoresBySymbol` already being populated.
 */
export const staticServiceResolver: CallResolver = {
  name: 'static-service',
  order: 20,

  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[] {
    const expr = call.getExpression()
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return []

    const receiver = expr.getExpression()
    if (!receiver.isKind(SyntaxKind.Identifier)) return []

    const symbol = receiver.getText()

    // data stores are not bodies to walk into
    if (ctx.dataStoresBySymbol.has(symbol)) return []

    const file = ctx.imports.get(symbol)
    if (!file) return []

    return [{ file, member: expr.getName() }]
  },
}
