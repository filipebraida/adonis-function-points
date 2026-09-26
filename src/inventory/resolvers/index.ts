import type { CallResolver } from './types.js'

import { actionObjectResolver } from './action_object.js'
import { eventDispatchResolver } from './event_dispatch.js'
import { jobDispatchResolver } from './job_dispatch.js'
import { localFunctionResolver } from './local_function.js'
import { moduleFunctionResolver } from './module_function.js'
import { propertyServiceResolver } from './property_service.js'
import { sameClassMethodResolver } from './same_class_method.js'
import { staticServiceResolver } from './static_service.js'
import { transformerResolver } from './transformer.js'

export * from './types.js'

/**
 * Built-in strategies, ordered from most to least specific.
 *
 * They cover the patterns that appear in real AdonisJS applications. No closed
 * list can cover them all — a project with its own convention registers it in
 * `config/function_points.ts`, and it runs before these.
 */
export const BUILTIN_CALL_RESOLVERS: CallResolver[] = [
  sameClassMethodResolver, //   5  await this.persistExpiration(invite)
  actionObjectResolver, //     10  await new CreateUser().handle(payload)
  eventDispatchResolver, //    12  await events.OrderPlaced.dispatch(id)
  jobDispatchResolver, //      15  await CreateUserJob.dispatch(payload)
  transformerResolver, //     18  InviteTransformer.transform(invite)
  staticServiceResolver, //    20  await UserService.create(payload)
  propertyServiceResolver, //  30  await this.users.create(payload)
  localFunctionResolver, //    45  await proximos(id) — declared in the same file
  moduleFunctionResolver, //   50  await createUser(payload)
]

/**
 * The FIRST strategy that claims a call wins.
 *
 * This is not an implementation detail: syntactically identical shapes carry
 * different meanings. `CreateUserJob.dispatch(p)`, `UserService.create(p)` and
 * `User.find(p)` are all `Identifier.method(args)`, and only ordering tells
 * them apart. Hence specific strategies declare a lower `order` than generic
 * ones, and `module-function` comes last — it would match almost anything.
 */
/**
 * Does any strategy call this a technical write?
 *
 * Asked separately from resolution, because the strategy that recognises the call as
 * incidental is not necessarily the one that knows where it goes.
 */
export function isTechnicalWrite(
  call: import('ts-morph').CallExpression,
  ctx: import('./types.js').ResolverContext,
  resolvers: CallResolver[] = BUILTIN_CALL_RESOLVERS
): boolean {
  return resolvers.some((resolver) => resolver.technicalWrite?.(call, ctx) === true)
}

export function resolveCall(
  call: import('ts-morph').CallExpression,
  ctx: import('./types.js').ResolverContext,
  resolvers: CallResolver[] = BUILTIN_CALL_RESOLVERS
): { by: string; refs: import('../../types.js').HandlerRef[] } | null {
  for (const resolver of resolvers) {
    /**
     * Asked before `resolve`, and in the same order: a strategy that claims a
     * call as data-free must not be overtaken by a later, more generic one
     * following it into a body it has no business reading.
     */
    if (resolver.ignores?.(call, ctx)) return { by: resolver.name, refs: [] }

    const refs = resolver.resolve(call, ctx)
    if (refs.length > 0) return { by: resolver.name, refs }
  }
  return null
}

export type IgnoreCallsOptions = {
  /** the strategy's name — printed in the report beside the volume it declared data-free */
  name: string
  /** method names, matched on the callee: `getUrl` matches `x.getUrl(...)` */
  methods?: string[]
  /** a pattern over the callee's text: `/\bauthz\.can$/` */
  matching?: RegExp
  /** lower runs first; defaults to 1, before every built-in */
  order?: number
}

/**
 * A strategy that recognises a family of calls and knows they reach no data
 * store — a rate limiter, an attachment's URL, an authorisation check.
 *
 * Read from a real configuration, every such strategy was the same eight lines:
 * a helper to get the method name off the ts-morph node (the app does not depend
 * on ts-morph), a `resolve` that returns nothing, and one comparison. What the
 * design wants is kept — it is still a NAMED strategy, and `fp:count` still
 * reports the volume it declared data-free — and the ceremony is not.
 */
export function ignoreCalls(options: IgnoreCallsOptions): CallResolver {
  if (!options.methods?.length && !options.matching) {
    throw new Error(
      `ignoreCalls("${options.name}"): say what it ignores — \`methods\` or \`matching\``
    )
  }
  const methods = new Set(options.methods ?? [])

  return {
    name: options.name,
    order: options.order ?? 1,
    /** follows nothing: the whole point */
    resolve: () => [],
    ignores(call) {
      const callee = call.getExpression()
      const text = callee.getText()
      if (options.matching?.test(text)) return true
      if (methods.size === 0) return false
      const method =
        callee.getKindName() === 'PropertyAccessExpression' ? text.split('.').pop() : text
      return method !== undefined && methods.has(method)
    },
  }
}
