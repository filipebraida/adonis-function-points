import { SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

export const DISPATCH_METHODS = new Set([
  'dispatch',
  'dispatchMany',
  'dispatchLater',
  'enqueue',
  'later',
])

/**
 * The method that actually runs the job, by queue package.
 *
 * There is no single name, and this list grew twice by measurement rather than by
 * reasoning. `@rlanz/bull-queue` uses `handle`; `@nemoventures/adonis-jobs` calls
 * it `process`; `@adonisjs/queue` — the official package — generates
 * `async execute()` in its own `make:job` stub. Each omission cost the same: the
 * file resolved, no body was found, the dispatch was reported as an unknown, and
 * every write inside the job went uncounted.
 *
 * `execute` surfaced only once event dispatch started being followed, because the
 * listener was what enqueued the job and that path had never been walked. Which is
 * the argument for adding a name when a real application shows it: a list written
 * from imagination would have missed this one too.
 *
 * Ordered: a class declaring more than one is answering the dispatcher with the
 * first, and `handle` is the most common.
 */
export const EXECUTION_METHODS = ['handle', 'execute', 'process', 'run', 'perform'] as const

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

    /**
     * `dispatch` enqueues; the execution method is what touches data. When the
     * class declares one, that is the body that matters — and when it declares
     * none, the dispatch name is kept so the gap stays visible instead of being
     * quietly attributed to a body nobody found.
     */
    const classes = ctx.sourceFile(file)?.getClasses() ?? []
    const executes = EXECUTION_METHODS.find((name) => classes.some((c) => c.getMethod(name)))

    return [{ file, member: executes ?? expr.getName() }]
  },
}
