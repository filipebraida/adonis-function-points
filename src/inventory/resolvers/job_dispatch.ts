import { SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

const DISPATCH_METHODS = new Set(['dispatch', 'dispatchLater', 'enqueue', 'later'])

/**
 * "Job" pattern: the write happens asynchronously.
 *
 *     await CreateUserJob.dispatch({ userId })
 *
 * Runs before `static-service` on purpose: the syntactic shape is identical
 * (`Identifier.method(args)`) and the generic strategy would swallow the job.
 * The distinction is semantic, and it matters because the counting decision
 * differs.
 *
 * COUNTING DECISION: a job dispatched by a handler is followed as part of the
 * SAME transactional function, because IFPUG counts what the user recognises —
 * they click and the effect happens, even if execution is asynchronous. A
 * SCHEDULED job, which nobody dispatches, is a different thing: it is an entry
 * point of its own, and out of v1 scope — only HTTP routes are collected.
 */
export const jobDispatchResolver: CallResolver = {
  name: 'job-dispatch',
  order: 15,

  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[] {
    const expr = call.getExpression()
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return []
    if (!DISPATCH_METHODS.has(expr.getName())) return []

    const receiver = expr.getExpression()
    if (!receiver.isKind(SyntaxKind.Identifier)) return []

    const symbol = receiver.getText()
    if (ctx.dataStoresBySymbol.has(symbol)) return []

    const file = ctx.imports.get(symbol)
    if (!file) return []

    // `dispatch` enqueues; `handle` executes. When the class declares `handle`,
    // that is the body that matters.
    const declared = ctx.sourceFile(file)
    const hasHandle = declared?.getClasses().some((c) => c.getMethod('handle'))

    return [{ file, member: hasHandle ? 'handle' : expr.getName() }]
  },
}
