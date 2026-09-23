import { SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

const DISPATCH_METHODS = new Set(['dispatch', 'dispatchLater', 'enqueue', 'later'])

/**
 * Padrão "job": a escrita acontece de forma assíncrona.
 *
 *     await CreateUserJob.dispatch({ userId })
 *
 * Roda ANTES de `static-service` de propósito: a forma sintática é idêntica
 * (`Identificador.metodo(args)`) e a genérica engoliria o job. A distinção não
 * é sintática, é semântica — e importa porque a decisão de contagem é
 * diferente.
 *
 * DECISÃO DE CONTAGEM (ver docs/design/resolvers.md): o job despachado por um
 * handler é seguido como parte da MESMA função transacional, porque o IFPUG
 * conta pelo que o usuário reconhece — ele clica e o efeito acontece, mesmo
 * que a execução seja assíncrona. Job AGENDADO, que ninguém dispara, é outra
 * coisa: é ponto de entrada próprio e sai de um EntryPointCollector.
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

    // `dispatch` enfileira; quem executa é `handle`. Quando a classe define
    // `handle`, é o corpo dela que interessa.
    const declared = ctx.sourceFile(file)
    const hasHandle = declared?.getClasses().some((c) => c.getMethod('handle'))

    return [{ file, member: hasHandle ? 'handle' : expr.getName() }]
  },
}
