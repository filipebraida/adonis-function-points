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

    const local = expr.getText()
    const file = ctx.imports.get(local)
    if (!file) return []

    /**
     * The body carries the exported name, not the local one. Following the
     * local name through an alias finds nothing and reports the call as
     * unresolved for a reason that is not true.
     */
    return [{ file, member: ctx.exportedAs.get(local) ?? local }]
  },
}
