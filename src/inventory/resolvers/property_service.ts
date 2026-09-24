import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * "Injected dependency" pattern: the call leaves through a class property.
 *
 *     @inject()
 *     class InvoiceController {
 *       constructor(protected billing: BillingService) {}
 *       async queue() { await this.billing.enqueue(invoice) }
 *     }
 *
 * This is the official AdonisJS pattern, and in applications that use it, it is
 * frequently the only path from a route down to a write.
 *
 * **No type checker required.** `@inject()` only works with an explicit type
 * annotation — that annotation is how the container knows what to inject — so
 * the type is always in the AST as an imported identifier.
 */
export const propertyServiceResolver: CallResolver = {
  name: 'property-service',
  order: 30,

  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[] {
    const expression = call.getExpression()
    if (!Node.isPropertyAccessExpression(expression)) return []

    const receiver = expression.getExpression()
    if (!Node.isPropertyAccessExpression(receiver)) return []
    if (receiver.getExpression().getKind() !== SyntaxKind.ThisKeyword) return []

    const file = ctx.injected.get(receiver.getName())
    if (!file) return []

    return [{ file, member: expression.getName() }]
  },
}
