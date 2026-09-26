import { Node } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

import type { HandlerRef } from '../../types.js'
import type { CallResolver, ResolverContext } from './types.js'

/**
 * "Local function" pattern: a helper declared in the same file, not imported.
 *
 *     const lista = await proximos(id)          // function proximos() { … }
 *     return rows.map(paraLinha)                // const paraLinha = (row) => …
 *
 * A query object that keeps its helpers beside it is common, and before this
 * every such call was unresolved: the store a helper read was reached by nobody
 * from that route, and a value built by it left as a whole table handed in.
 *
 * Only module-level declarations: a closure declared inside a body is part of
 * that body, and the graph already walks it.
 */
export const localFunctionResolver: CallResolver = {
  name: 'local-function',
  // before `module-function`: both match a bare `identifier(args)`
  order: 45,

  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[] {
    const named = calledFunctionOf(call)
    if (!named) return []

    const name = named.getText()
    if (ctx.imports.has(name)) return []
    if (!declaresFunction(ctx.file, name)) return []

    return [{ file: ctx.file.getFilePath(), member: name }]
  },
}

/** callbacks that apply a function to each element: `rows.map(paraLinha)` calls `paraLinha` */
const APPLIES_CALLBACK = new Set([
  'map',
  'flatMap',
  'forEach',
  'filter',
  'find',
  'some',
  'every',
  'sort',
  'reduce',
])

/**
 * The function a call names: `proximos(id)` names `proximos`; `rows.map(paraLinha)`
 * names `paraLinha`, called once per row — the body the graph must read is the
 * same, whichever way it was reached.
 */
export function calledFunctionOf(call: CallExpression): import('ts-morph').Identifier | null {
  const expression = call.getExpression()
  if (Node.isIdentifier(expression)) return expression
  if (Node.isPropertyAccessExpression(expression) && APPLIES_CALLBACK.has(expression.getName())) {
    const callback = call.getArguments()[0]
    if (callback && Node.isIdentifier(callback)) return callback
  }
  return null
}

/** `function name() {}` or `const name = () => {}` / `function () {}` at module level */
export function declaresFunction(file: import('ts-morph').SourceFile, name: string): boolean {
  if (file.getFunction(name)) return true
  const initializer = file.getVariableDeclaration(name)?.getInitializer()
  return (
    !!initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
  )
}
