import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression, Expression, SourceFile } from 'ts-morph'

import { detectAccess, rootSymbolOf } from '../detectors/lucid.js'
import type { RelationMap, StoreSymbols } from '../detectors/lucid.js'
import { mappedLiteralOf, unwrap } from './output_fields.js'
import type { HandlerRef } from '../../types.js'

/**
 * What a transaction DELIVERS — counting-decisions §6, plan 0.7 §A′.
 *
 * The DETs of an output are the fields that cross the boundary, and the place
 * they cross is the delivery: the props handed to `inertia.render` /
 * `inertia.modal` / `view.render`, the payload of `response.json|ok|created|send`,
 * a literal the handler returns. Before this, "what leaves" was every column of
 * every store the transaction touched — a `findOrFail` made to authorise handed
 * the whole table to the screen, and a derived `total` handed nothing.
 *
 * Measured on three applications first: no delivered collection is a variable
 * bound to a store; they come out of query objects the graph already follows.
 * So a delivered value that comes from a followed call is resolved to what that
 * body returns — the graph does that in `run()`, once the bodies are known; this
 * module only says WHAT was delivered and where it came from.
 */

export type Delivery =
  /** a variable bound to a store: its columns leave */
  | { kind: 'store'; store: string; path: string }
  /** the result of a call a strategy followed: what that body returns leaves */
  | { kind: 'call'; refs: HandlerRef[]; path: string; expression: string }
  /** a scalar, a property, an expression: one DET */
  | { kind: 'scalar'; path: string }
  /** an input echoed back — the validated payload, a field read off the request: counts once, on entry */
  | { kind: 'echo'; path: string }
  /** something the classifier cannot read: one DET as a floor, reported */
  | { kind: 'opaque'; path: string; expression: string }

/** `inertia.render(page, props)`, `inertia.modal(page, props)`, `view.render(view, props)` */
const RENDERERS = new Set(['inertia', 'view'])
const RENDER_METHODS = new Set(['render', 'modal'])
/** `response.json(x)`, `.ok(x)`, `.created(x)`, `.send(x)`, `.accepted(x)` */
const RESPONSE_METHODS = new Set(['json', 'ok', 'created', 'accepted', 'send'])
/** `x.data`, `x.rows` on a paginated / wrapped result hand the collection on */
const PASSES_THROUGH = new Set(['data', 'rows', 'all', 'toJSON', 'serialize'])
/** reads of the request whose result echoes input already counted on entry */
const ECHOES_INPUT = new Set(['validateUsing', 'input', 'only', 'all', 'body', 'qs', 'params'])

export type DeliveryContext = {
  body: Node
  file: SourceFile
  symbols: StoreSymbols
  relations: RelationMap
  followed: Map<CallExpression, HandlerRef[]>
}

export type BodyDeliveries = {
  /** props handed to a renderer or a response method, anywhere in the body */
  calls: Delivery[]
  /** a delivery call was found, even with nothing readable in it */
  anyCall: boolean
  /**
   * What a `return` hands back that is not one of those calls — meaningful for
   * the ENTRY body only, where returning a value is delivering it; a followed
   * body's return is read by `returnedLeavesOf` instead.
   */
  returns: Delivery[]
  anyReturn: boolean
}

/**
 * The deliveries of a body: every props argument handed to a renderer or a
 * response method, and what a `return` hands back that is not one of those calls.
 */
export function deliveriesIn(ctx: DeliveryContext): BodyDeliveries {
  const deliveries: Delivery[] = []
  const returns: Delivery[] = []
  let any = false
  let anyReturn = false
  const seen = new Set<Node>()

  for (const call of ctx.body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression()
    if (!Node.isPropertyAccessExpression(callee)) continue
    const method = callee.getName()
    const receiver = lastSegmentOf(callee.getExpression())

    let payload: Node | undefined
    if (RENDERERS.has(receiver) && RENDER_METHODS.has(method)) payload = call.getArguments()[1]
    else if (receiver === 'response' && RESPONSE_METHODS.has(method))
      payload = call.getArguments()[0]
    else continue

    any = true
    if (!payload) continue
    seen.add(call)
    classify(unwrap(payload), '', ctx, deliveries, 0)
  }

  {
    for (const statement of ctx.body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      const enclosing = statement.getFirstAncestor(
        (node) =>
          Node.isArrowFunction(node) ||
          Node.isFunctionExpression(node) ||
          Node.isMethodDeclaration(node) ||
          Node.isFunctionDeclaration(node)
      )
      if (enclosing !== ctx.body) continue

      const value = unwrap(statement.getExpression())
      if (!value) continue
      if (Node.isCallExpression(value)) {
        if (seen.has(value)) continue
        /**
         * `return response.redirect().toRoute(…)`, `return response.noContent()`,
         * `return inertia.render(…)` (seen above): a call whose chain is rooted at
         * the response or a renderer is the response itself, not a value handed
         * back — nothing to classify.
         */
        const root = chainRootOf(value)
        if (root && (RENDERERS.has(root) || root === 'response')) continue
      }
      anyReturn = true
      classify(value, '', ctx, returns, 0)
    }
  }

  return { calls: deliveries, anyCall: any, returns, anyReturn }
}

/** the identifier a call chain is rooted at: `response.redirect().toRoute(x)` -> 'response' */
function chainRootOf(node: Node): string | null {
  let current: Node | undefined = node
  for (let depth = 0; current && depth < 40; depth++) {
    if (Node.isCallExpression(current) || Node.isPropertyAccessExpression(current)) {
      current = current.getExpression()
      continue
    }
    if (Node.isAwaitExpression(current) || Node.isParenthesizedExpression(current)) {
      current = current.getExpression()
      continue
    }
    return Node.isIdentifier(current)
      ? current.getText()
      : Node.isThisExpression(current)
        ? 'this'
        : null
  }
  return null
}

/** `ctx.inertia` -> 'inertia', `inertia` -> 'inertia', `this.response` -> 'response' */
function lastSegmentOf(node: Node): string {
  if (Node.isPropertyAccessExpression(node)) return node.getName()
  return node.getText()
}

function classify(
  value: Expression | null,
  path: string,
  ctx: DeliveryContext,
  out: Delivery[],
  depth: number
): void {
  if (!value || depth > 6) return

  if (Node.isObjectLiteralExpression(value)) {
    for (const property of value.getProperties()) {
      if (Node.isShorthandPropertyAssignment(property)) {
        classify(property.getNameNode(), join(path, property.getName()), ctx, out, depth + 1)
      } else if (Node.isPropertyAssignment(property)) {
        const name = property.getName().replace(/^['"]|['"]$/g, '')
        classify(unwrap(property.getInitializer()), join(path, name), ctx, out, depth + 1)
      } else if (Node.isSpreadAssignment(property)) {
        classify(unwrap(property.getExpression()), path, ctx, out, depth + 1)
      } else {
        out.push({ kind: 'scalar', path: join(path, property.getName?.() ?? '*') })
      }
    }
    return
  }

  if (Node.isConditionalExpression(value)) {
    classify(unwrap(value.getWhenTrue()), path, ctx, out, depth + 1)
    classify(unwrap(value.getWhenFalse()), path, ctx, out, depth + 1)
    return
  }

  if (Node.isIdentifier(value)) {
    const name = value.getText()
    if (ctx.symbols.has(name)) {
      out.push({ kind: 'store', store: ctx.symbols.get(name)!, path })
      return
    }
    const initializer = initializerOf(name, ctx.body)
    if (initializer) {
      classify(initializer, path, ctx, out, depth + 1)
      return
    }
    if (isEchoBinding(name, ctx.body)) {
      out.push({ kind: 'echo', path })
      return
    }
    out.push({ kind: 'scalar', path })
    return
  }

  if (Node.isCallExpression(value)) {
    const callee = value.getExpression()
    const method = Node.isPropertyAccessExpression(callee) ? callee.getName() : ''

    if (
      Node.isPropertyAccessExpression(callee) &&
      ECHOES_INPUT.has(method) &&
      isRequestLike(callee.getExpression())
    ) {
      out.push({ kind: 'echo', path })
      return
    }

    // `xs.map((x) => ({ a, b }))`: a repeating group, its leaves once
    const mapped = mappedLiteralOf(value)
    if (mapped) {
      classify(mapped, path, ctx, out, depth + 1)
      return
    }
    if (method === 'map') {
      out.push({ kind: 'scalar', path })
      return
    }

    const refs = ctx.followed.get(value)
    if (refs && refs.length > 0) {
      out.push({
        kind: 'call',
        refs,
        path,
        expression: value.getText().replace(/\s+/g, '').slice(0, 60),
      })
      return
    }

    // `Form.all()`, `Produto.query()…` handed straight to the response
    const access = detectAccess(value, ctx.symbols, ctx.relations)
    if (access) {
      out.push({ kind: 'store', store: access.store, path })
      if (access.viaRelation) out.push({ kind: 'store', store: access.viaRelation, path })
      return
    }

    // `.length`-like scalars off a call, `Number(x)`, `String(x)`
    if (Node.isIdentifier(callee) && /^(Number|String|Boolean|Math|Date)$/.test(callee.getText())) {
      out.push({ kind: 'scalar', path })
      return
    }

    out.push({ kind: 'opaque', path, expression: value.getText().replace(/\s+/g, '').slice(0, 60) })
    return
  }

  if (Node.isPropertyAccessExpression(value) || Node.isElementAccessExpression(value)) {
    const root = rootSymbolOf(value)
    const property = Node.isPropertyAccessExpression(value) ? value.getName() : ''

    // `resultado.data`, `paginado.rows`: the collection a followed call produced, handed on
    if (root && PASSES_THROUGH.has(property)) {
      const initializer = initializerOf(root, ctx.body)
      if (initializer && Node.isCallExpression(initializer)) {
        const refs = ctx.followed.get(initializer)
        if (refs && refs.length > 0) {
          out.push({
            kind: 'call',
            refs,
            path,
            expression: initializer.getText().replace(/\s+/g, '').slice(0, 60),
          })
          return
        }
        const access = detectAccess(initializer, ctx.symbols, ctx.relations)
        if (access) {
          out.push({ kind: 'store', store: access.store, path })
          return
        }
      }
      if (root && ctx.symbols.has(root)) {
        out.push({ kind: 'store', store: ctx.symbols.get(root)!, path })
        return
      }
    }

    // a field of a validated payload, or of the request
    if (root && (isEchoBinding(root, ctx.body) || root === 'request' || root === 'params')) {
      out.push({ kind: 'echo', path })
      return
    }

    out.push({ kind: 'scalar', path })
    return
  }

  if (Node.isAwaitExpression(value)) {
    classify(unwrap(value.getExpression()), path, ctx, out, depth + 1)
    return
  }

  // literals, template strings, arithmetic, comparisons, `new Date()`: one value leaves
  out.push({ kind: 'scalar', path })
}

const join = (prefix: string, name: string) => (prefix ? `${prefix}.${name}` : name)

/** the initializer of a local `const x = …` declared in this body */
function initializerOf(name: string, body: Node): Expression | null {
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (declaration.getName() !== name) continue
    return unwrap(declaration.getInitializer())
  }
  return null
}

/**
 * A name bound by destructuring the validated payload or the request:
 * `const { busca } = await request.validateUsing(x)`, `const { id } = params`.
 */
function isEchoBinding(name: string, body: Node): boolean {
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const binding = declaration.getNameNode()
    if (!Node.isObjectBindingPattern(binding)) continue
    if (!binding.getElements().some((element) => element.getName() === name)) continue
    const initializer = unwrap(declaration.getInitializer())
    if (!initializer) continue
    if (Node.isIdentifier(initializer) && /^(params|request)$/.test(initializer.getText()))
      return true
    if (Node.isCallExpression(initializer)) {
      const callee = initializer.getExpression()
      if (Node.isPropertyAccessExpression(callee) && ECHOES_INPUT.has(callee.getName())) return true
    }
  }
  return false
}

const isRequestLike = (node: Node) => lastSegmentOf(node) === 'request'
