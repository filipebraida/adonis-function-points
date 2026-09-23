import type { CallResolver, ResolverRegistry } from './types.js'

import { actionObjectResolver } from './action_object.js'
import { jobDispatchResolver } from './job_dispatch.js'
import { moduleFunctionResolver } from './module_function.js'
import { propertyServiceResolver } from './property_service.js'
import { staticServiceResolver } from './static_service.js'

export * from './types.js'

/**
 * Estratégias embutidas, em ordem de especificidade.
 *
 * Cobrem os padrões que aparecem em apps AdonisJS reais. Nenhuma lista fechada
 * dá conta de todos — um projeto com convenção própria registra a sua em
 * `config/function_points.ts` e ela entra antes das embutidas.
 *
 * Medição do spike contra uma app real (159 rotas):
 *   sem nenhum resolvedor .......... 20 transações com escrita detectada
 *   + actionObjectResolver ......... 45
 *   demais padrões ................. em aberto, ver docs/research/spike-findings.md
 */
export const BUILTIN_CALL_RESOLVERS: CallResolver[] = [
  actionObjectResolver, //  10  await new CreateUser().handle(payload)
  jobDispatchResolver, //  15  await CreateUserJob.dispatch(payload)
  staticServiceResolver, //  20  await UserService.create(payload)
  propertyServiceResolver, //  30  await this.users.create(payload)
  moduleFunctionResolver, //  50  await createUser(payload)
]

/**
 * A PRIMEIRA estratégia que reivindica uma chamada vence.
 *
 * Não é detalhe de implementação: formas sintaticamente idênticas têm
 * significados diferentes. `CreateUserJob.dispatch(p)` e
 * `UserService.create(p)` são ambas `Identificador.metodo(args)`, e só a
 * ordem separa uma da outra. Por isso as estratégias específicas declaram
 * `order` menor que as genéricas, e `module-function` fica por último —
 * ela casaria com quase tudo.
 */
export function resolveCall(
  call: import('ts-morph').CallExpression,
  ctx: import('./types.js').ResolverContext,
  resolvers: CallResolver[] = BUILTIN_CALL_RESOLVERS
): { by: string; refs: import('../../types.js').HandlerRef[] } | null {
  for (const resolver of resolvers) {
    const refs = resolver.resolve(call, ctx)
    if (refs.length > 0) return { by: resolver.name, refs }
  }
  return null
}

export function createRegistry(extra: Partial<ResolverRegistry> = {}): ResolverRegistry {
  const byOrder = (a: { order?: number }, b: { order?: number }) =>
    (a.order ?? 100) - (b.order ?? 100)

  return {
    callResolvers: [...(extra.callResolvers ?? []), ...BUILTIN_CALL_RESOLVERS].sort(byOrder),
    persistenceDetectors: [...(extra.persistenceDetectors ?? [])].sort(byOrder),
    dataStoreCollectors: [...(extra.dataStoreCollectors ?? [])],
    entryPointCollectors: [...(extra.entryPointCollectors ?? [])],
  }
}
