import { Node } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import { rootSymbolOf } from '../detectors/lucid.js'
import { isTransformerClass } from '../graph/output_fields.js'
import type { CallResolver, ResolverContext } from './types.js'

/** BaseTransformer's public API; all of it funnels through `toObject` */
const TRANSFORMER_METHODS = new Set([
  'transform',
  'paginate',
  'toJSON',
  'useVariant',
  'withVariant',
])

/** what the application-side body is called */
const APPLICATION_BODY = 'toObject'

/**
 * "Transformer" pattern: the package supplies the API, the application
 * supplies the body.
 *
 *     class InviteTransformer extends BaseTransformer<Invite> {
 *       toObject() { … }
 *     }
 *
 *     InviteTransformer.transform(invite)
 *
 * `transform()` and `paginate()` live in `@adonisjs/core`, so resolving the
 * symbol lands on the application file and finds no body there. The naive
 * reading is that the tracer must step into node_modules; it does not. Those
 * methods call BACK into `toObject()`, which the application writes, so the
 * body worth analysing was in the application all along.
 *
 * It is the same shape as `job-dispatch`, where `dispatch` enqueues and
 * `handle` executes.
 *
 * COUNTING DECISION: the write a transformer performs belongs to the
 * transaction that serialised through it. Without this, a table written only
 * inside `toObject()` is reached by nobody and drops out under AFP §6.5.4.
 */
export const transformerResolver: CallResolver = {
  name: 'transformer',
  // before `static-service`: `X.transform(p)` is `Identifier.method(args)` too
  order: 18,

  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[] {
    const expression = call.getExpression()
    if (!Node.isPropertyAccessExpression(expression)) return []
    if (!TRANSFORMER_METHODS.has(expression.getName())) return []

    /**
     * The root of the chain, so `X.transform(p).useVariant(v)` resolves as
     * well as `X.transform(p)`. Analysing the same body twice is free: the
     * graph dedupes by file and member.
     */
    const symbol = rootSymbolOf(expression.getExpression())
    if (!symbol) return []

    const file = ctx.imports.get(symbol) ?? ctx.injected.get(symbol)
    if (!file) return []

    /**
     * One definition of what a transformer is, shared with the output walker
     * (`graph/output_fields.ts`): the resolver must not follow a body whose keys
     * the walker would refuse to read, or the other way round.
     */
    const declared = ctx.sourceFile(file)
    if (!declared || !declared.getClasses().some(isTransformerClass)) return []

    const owner = declared.getClasses().find((cls) => cls.getMethod(APPLICATION_BODY))
    return owner ? [{ file, member: APPLICATION_BODY }] : []
  },
}
