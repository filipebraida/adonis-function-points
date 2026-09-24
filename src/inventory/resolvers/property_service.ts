import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * Padrão "dependência injetada": a chamada sai de uma propriedade da classe.
 *
 *     @inject()
 *     class InvoiceController {
 *       constructor(protected billing: BillingService) {}
 *       async queue() { await this.billing.enqueue(intake) }
 *     }
 *
 * É o padrão oficial do AdonisJS, e medido numa app de produção respondia por
 * quase todas as transações de escrita que o grafo não alcançava: 68 rotas
 * paravam no primeiro passo com `this.algumServiço.metodo()`.
 *
 * **Não precisa de type checker.** Uma análise anterior supôs que precisaria, e
 * estava errada: o `@inject()` só funciona com a anotação de tipo explícita —
 * é dela que o container tira o que injetar. Então o tipo está sempre no AST,
 * como identificador importado.
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
