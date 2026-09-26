import { Node, SyntaxKind } from 'ts-morph'
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
/** the variant named in these is a method of the transformer, and part of what leaves */
const VARIANT_METHODS = new Set(['useVariant', 'withVariant'])

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
/** is `.useVariant('x')` / `.withVariant('x')` the next link of this call's chain? */
function variantFollows(call: CallExpression): boolean {
  let node: import('ts-morph').Node = call
  for (let depth = 0; depth < 20; depth++) {
    const parent = node.getParent()
    if (!parent) return false
    if (Node.isAwaitExpression(parent) || Node.isParenthesizedExpression(parent)) {
      node = parent
      continue
    }
    if (!Node.isPropertyAccessExpression(parent) || parent.getExpression() !== node) return false
    const next = parent.getParent()
    if (!next || !Node.isCallExpression(next) || next.getExpression() !== parent) return false
    if (VARIANT_METHODS.has(parent.getName()))
      return next.getArguments()[0]?.getKind() === SyntaxKind.StringLiteral
    node = next
  }
  return false
}

/** the transformer class a chain call is on, if it is one: `X.transform(p)`, `X.transform(p).useVariant(v)` */
function transformerOf(
  call: CallExpression,
  ctx: ResolverContext
): { file: string; owner: import('ts-morph').ClassDeclaration } | null {
  const expression = call.getExpression()
  if (!Node.isPropertyAccessExpression(expression)) return null
  if (!TRANSFORMER_METHODS.has(expression.getName())) return null

  /**
   * The root of the chain, so `X.transform(p).useVariant(v)` resolves as
   * well as `X.transform(p)`. Analysing the same body twice is free: the
   * graph dedupes by file and member.
   */
  const symbol = rootSymbolOf(expression.getExpression())
  if (!symbol) return null

  const file = ctx.imports.get(symbol) ?? ctx.injected.get(symbol)
  if (!file) return null

  /**
   * One definition of what a transformer is, shared with the output walker
   * (`graph/output_fields.ts`): the resolver must not follow a body whose keys
   * the walker would refuse to read, or the other way round.
   */
  const declared = ctx.sourceFile(file)
  if (!declared || !declared.getClasses().some(isTransformerClass)) return null

  const owner = declared.getClasses().find((cls) => cls.getMethod(APPLICATION_BODY))
  return owner ? { file, owner } : null
}

export const transformerResolver: CallResolver = {
  name: 'transformer',
  // before `static-service`: `X.transform(p)` is `Identifier.method(args)` too
  order: 18,

  /**
   * The `transform` before a `useVariant`: claimed and followed nowhere, or
   * `static-service` would take it next, look for a `transform` body in the
   * application file and report the package method as a gap.
   */
  ignores(call: CallExpression, ctx: ResolverContext): boolean {
    const expression = call.getExpression()
    if (!Node.isPropertyAccessExpression(expression)) return false
    if (VARIANT_METHODS.has(expression.getName()) || !variantFollows(call)) return false
    return transformerOf(call, ctx) !== null
  },

  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[] {
    const expression = call.getExpression()
    if (!Node.isPropertyAccessExpression(expression)) return []
    const found = transformerOf(call, ctx)
    if (!found) return []
    const { file, owner } = found

    /**
     * `X.transform(p).useVariant('forEgresso')`: the variant is a METHOD of the
     * transformer, named after it, and it REPLACES `toObject()` — the shape that
     * leaves is the variant's. The chain is visited call by call: the `useVariant`
     * call resolves the variant's body, and the `transform` call before it resolves
     * nothing, or both shapes would leave and the page would count twice.
     */
    if (VARIANT_METHODS.has(expression.getName())) {
      const variant = call.getArguments()[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
      return variant && owner.getMethod(variant)
        ? [{ file, member: variant }]
        : [{ file, member: APPLICATION_BODY }]
    }
    if (variantFollows(call)) return []
    return [{ file, member: APPLICATION_BODY }]
  },
}
