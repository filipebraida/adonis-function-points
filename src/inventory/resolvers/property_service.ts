import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * Padrão "service injetado": a dependência vive numa propriedade da classe.
 *
 *     await this.users.create(payload)
 *     await this.repo.persist(user)
 *
 * Exige resolver o TIPO da propriedade até a classe que a implementa — é o
 * caso mais caro, porque depende do type checker e não só do AST.
 *
 * TODO: implementar via ctx.file.getTypeChecker(). Enquanto não estiver
 * pronto, estas chamadas caem em `unresolved` e APARECEM no relatório de
 * cobertura — que é o comportamento correto: silenciar viraria falso "só lê".
 */
export const propertyServiceResolver: CallResolver = {
  name: 'property-service',
  order: 30,

  resolve(_call: CallExpression, _ctx: ResolverContext): HandlerRef[] {
    return []
  },
}
