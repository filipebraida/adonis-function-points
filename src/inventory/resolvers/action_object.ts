import { SyntaxKind } from 'ts-morph'
import type { CallExpression, Node } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * "Action object" pattern: the transaction delegates to an action instantiated
 * at the call site.
 *
 *     await new ExpireInvite().handle({ invite })
 *
 *     const mark = new MarkContentChanged()
 *     await mark.handle({ documentId })
 *
 * The second form keeps the instance in a local variable, so the declaration
 * has to be followed back to the `new` — that is what `classOfReceiver` does.
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
 * Finds the class behind a call receiver.
 *
 *   new Foo().handle()                    -> 'Foo'
 *   foo.handle()  where  const foo = new Foo()  -> 'Foo'
 */
function classOfReceiver(receiver: Node): string | null {
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
