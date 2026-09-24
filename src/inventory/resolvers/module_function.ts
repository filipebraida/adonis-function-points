import { SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * "Module function" pattern: no class at all.
 *
 *     await createUser(payload)
 *     await syncWithProvider(order)
 *
 * Runs last: it matches any call to an imported identifier and would otherwise
 * swallow the more precise patterns.
 */
export const moduleFunctionResolver: CallResolver = {
  name: 'module-function',
  order: 50,

  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[] {
    const expr = call.getExpression()
    if (!expr.isKind(SyntaxKind.Identifier)) return []

    const file = ctx.imports.get(expr.getText())
    if (!file) return []

    return [{ file, member: expr.getText() }]
  },
}
