import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import { resolveEventClass } from '../sources/event_bindings.js'
import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * "Event" pattern: the handler announces, and listeners act.
 *
 *     await events.OrderPlaced.dispatch(order.id)
 *
 * Runs BEFORE `job-dispatch`, which matches `Identifier.dispatch(args)` — the
 * shape the direct form takes. Left to it, the event class was resolved and
 * searched for a `handle` it does not declare (`dispatch` comes from
 * `BaseEvent`), so the call was reported as an unknown and the listeners' reads
 * and writes went uncounted.
 *
 * COUNTING DECISION: the same one taken for a job. The user clicks, the effect
 * happens, and AFP §6.5.3 requires aggregating every path the transaction
 * reaches — the emitter is an implementation detail of how it gets there.
 */
export const eventDispatchResolver: CallResolver = {
  name: 'event-dispatch',
  order: 12,

  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[] {
    if (ctx.eventBindings.size === 0) return []

    const expression = call.getExpression()
    if (!expression.isKind(SyntaxKind.PropertyAccessExpression)) return []
    if (expression.getName() !== 'dispatch') return []

    const receiver = expression.getExpression()
    if (!Node.isIdentifier(receiver) && !Node.isPropertyAccessExpression(receiver)) return []

    const eventFile = resolveEventClass(receiver, ctx.file, {
      resolveSpecifier: ctx.resolveSpecifier,
    })

    return eventFile ? (ctx.eventBindings.get(eventFile) ?? []) : []
  },
}
