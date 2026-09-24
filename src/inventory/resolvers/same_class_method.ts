import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * "Same class method" pattern: `this.privateMethod()`.
 *
 *     async expire(uuid: string) {
 *       const invite = await this.findByUuid(uuid)
 *       await this.persistExpiration(invite)
 *     }
 *
 * A public method delegating to private ones of the same class is where writes
 * often live. No other strategy covers it — `property-service` requires
 * `this.dependency.method()`, with two levels of access.
 *
 * Runs before `property-service` because it is more specific: the receiver is
 * exactly `this`.
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

    /**
     * Only claim the call if the method really exists on the class. Otherwise
     * `this.someFunctionProperty()` would be claimed, the body lookup would
     * fail, and the report would blame inheritance from a package — sending the
     * reader to the wrong place.
     */
    if (!owner.getMethod(member) && !owner.getStaticMethod(member)) return []

    return [{ file: ctx.file.getFilePath(), member }]
  },
}
