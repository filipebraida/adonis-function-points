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

    let init = decl?.asKind(SyntaxKind.VariableDeclaration)?.getInitializer()
    while (
      init?.isKind(SyntaxKind.AwaitExpression) ||
      init?.isKind(SyntaxKind.ParenthesizedExpression)
    )
      init = init.getExpression()
    if (init?.isKind(SyntaxKind.NewExpression)) {
      const target = init.getExpression()
      return target.isKind(SyntaxKind.Identifier) ? target.getText() : null
    }

    /**
     * `const svc = await app.container.make(AssignmentService)`: the container hands
     * back an instance of the class named — the same binding as `new`, written the
     * way a controller writes it when the service has dependencies of its own. On a
     * reviewed application this shape carried the write of `POST /assignments`
     * and 31 more sites, and none was followed (plan 0.8 §B).
     */
    if (init?.isKind(SyntaxKind.CallExpression)) {
      const callee = init.getExpression()
      if (
        callee.isKind(SyntaxKind.PropertyAccessExpression) &&
        callee.getName() === 'make' &&
        callee.getExpression().isKind(SyntaxKind.PropertyAccessExpression) &&
        callee.getExpression().asKind(SyntaxKind.PropertyAccessExpression)!.getName() ===
          'container'
      ) {
        const made = init.getArguments()[0]
        return made?.isKind(SyntaxKind.Identifier) ? made.getText() : null
      }
    }
  }

  return null
}
