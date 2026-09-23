import { SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * Padrão "action object": a transação delega para um objeto de ação
 * instanciado na hora.
 *
 *     await new ExpireInvite().handle({ invite })
 *     const mark = new MarkContentChanged()
 *     await mark.handle({ documentId })
 *
 * Foi o padrão dominante na app medida no spike: habilitá-lo levou a detecção
 * de escrita de 20 para 45 das 159 transações.
 *
 * A segunda forma (instância guardada numa variável local) exige seguir a
 * declaração da variável até o `new` — é o que `classOfReceiver` faz.
 */
export const actionObjectResolver: CallResolver = {
  name: 'action-object',
  order: 10,

  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[] {
    const expr = call.getExpression()
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return []

    const member = expr.getName()
    const className = classOfReceiver(expr.getExpression())
    if (!className) return []

    const file = ctx.imports.get(className)
    if (!file) return []

    return [{ file, member }]
  },
}

/**
 * Descobre a classe por trás do receptor de uma chamada.
 *
 *   new Foo().handle()     -> 'Foo'
 *   foo.handle()  onde  const foo = new Foo()   -> 'Foo'
 */
function classOfReceiver(receiver: import('ts-morph').Node): string | null {
  if (receiver.isKind(SyntaxKind.NewExpression)) {
    const target = receiver.getExpression()
    return target.isKind(SyntaxKind.Identifier) ? target.getText() : null
  }

  if (receiver.isKind(SyntaxKind.Identifier)) {
    const decl = receiver
      .getSymbol()
      ?.getDeclarations()
      .find((d) => d.isKind(SyntaxKind.VariableDeclaration))

    const init = decl?.asKind(SyntaxKind.VariableDeclaration)?.getInitializer()
    if (init?.isKind(SyntaxKind.NewExpression)) {
      const target = init.getExpression()
      return target.isKind(SyntaxKind.Identifier) ? target.getText() : null
    }
  }

  return null
}
