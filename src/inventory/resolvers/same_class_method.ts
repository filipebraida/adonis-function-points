import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * Padrão "método da própria classe": `this.metodoPrivado()`.
 *
 *     async expire(uuid: string) {
 *       const invite = await this.findByUuid(uuid)
 *       await this.persistExpiration(invite)
 *     }
 *
 * Foi o padrão dominante entre as rotas que não alcançavam dado nenhum numa app
 * de produção: o método público delega a privados da mesma classe, e é lá que a
 * escrita acontece.
 *
 * Nenhum resolvedor o cobria — `property-service` exige `this.prop.metodo()`,
 * com dois níveis de acesso. Roda antes dele porque é mais específico: o
 * receptor é exatamente `this`.
 */
export const sameClassMethodResolver: CallResolver = {
  name: 'same-class-method',
  order: 5,

  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[] {
    const expression = call.getExpression()
    if (!Node.isPropertyAccessExpression(expression)) return []
    if (expression.getExpression().getKind() !== SyntaxKind.ThisKeyword) return []

    const member = expression.getName()
    const owner = call.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)
    if (!owner) return []

    // só reivindica se o método existir mesmo na classe; senão é `this.dep.x()`
    // ou propriedade injetada, e outra estratégia decide
    if (!owner.getMethod(member) && !owner.getStaticMethod(member)) return []

    return [{ file: ctx.file.getFilePath(), member }]
  },
}
