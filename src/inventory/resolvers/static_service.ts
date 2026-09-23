import { SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * Padrão "service estático": método de classe chamado sem instanciar.
 *
 *     await UserService.create(payload)
 *     await OrderService.finalize(order)
 *
 * Cuidado: `Order.findByOrFail(...)` tem exatamente a mesma FORMA sintática.
 * A diferença é semântica — model é repositório de dados, não corpo a
 * percorrer, e quem cuida dele é o PersistenceDetector. Por isso este
 * resolvedor depende de `ctx.dataStoresBySymbol` já estar populado.
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

    // repositórios de dados não são corpos a percorrer
    if (ctx.dataStoresBySymbol.has(symbol)) return []

    const file = ctx.imports.get(symbol)
    if (!file) return []

    return [{ file, member: expr.getName() }]
  },
}
