import { Node, SyntaxKind } from 'ts-morph'
import type {
  CallExpression,
  ClassDeclaration,
  Expression,
  ObjectLiteralExpression,
} from 'ts-morph'

import type { CollectedDataStore } from '../sources/data_stores.js'

/**
 * What an output transaction actually EMITS — counting-decisions §6.
 *
 * AFP §7.3 counts one DET per unique field that leaves the boundary. Without
 * reading what leaves, the only repeatable answer is "every column of every
 * table read", and that is what the count did: a detail screen passing through
 * three transformers came out at 67 DET. The transformer is where the
 * application says which fields cross, so it is read here.
 *
 * Two facts are extracted, and both are about the BODY, so they are cached with
 * the rest of its facts:
 *
 *   outputs   the keys a transformer method returns — `LivroTransformer.titulo`
 *   selected  the columns a query names in `.select()` — per store
 *
 * Everything the walker cannot read is a placeholder, never a guess: an
 * unreadable spread counts 1 DET as a floor and is reported, the same treatment
 * an open `vine.object` gets on the input side (§9).
 */

export type OutputFacts = {
  /** qualified keys emitted by this transformer body */
  outputs: string[]
  /** of those, the placeholders: a spread the walker could not read */
  opaqueOutputs: string[]
  /**
   * The store this transformer is FOR — `BaseTransformer<Livro>` — when it is a
   * known store. A transformer decides what leaves for its resource, not for the
   * page: a store read beside it and passed raw is not covered.
   */
  resource: string | null
}

/** how a body reads a store, per chain — what leaves when nothing transforms it */
export type StoreRead = {
  store: string
  shape: 'whole' | 'select' | 'aggregate'
  /** for `select`: the columns named */
  columns: string[]
  /**
   * The store this one was preloaded THROUGH (`Livro.query().preload('autor')`),
   * when it was not read by a chain of its own. A relation loaded for a
   * transformer is consumed by it, not shown.
   */
  via?: string
}

/**
 * Does this class extend a transformer base from a package?
 *
 * Decided by the base's name AND by its import being a bare specifier, so an
 * application class that merely happens to own a `transform` method is not
 * mistaken for one. Shared with the `transformer` resolver: one definition of
 * what a transformer is, or the resolver follows a body this walker refuses.
 */
export function isTransformerClass(cls: ClassDeclaration): boolean {
  const base = cls.getExtends()?.getExpression()
  const name = base?.asKind(SyntaxKind.Identifier)?.getText()
  if (!name?.endsWith('Transformer')) return false

  const imported = cls
    .getSourceFile()
    .getImportDeclarations()
    .find((declaration) => declaration.getNamedImports().some((named) => named.getName() === name))

  return imported !== undefined && !imported.getModuleSpecifierValue().startsWith('#')
}

/** `class X extends BaseTransformer<Livro>` -> 'Livro' */
export function transformerResourceOf(cls: ClassDeclaration): string | null {
  const argument = cls.getExtends()?.getTypeArguments()[0]
  return argument?.asKind(SyntaxKind.TypeReference)?.getTypeName().getText() ?? null
}

/**
 * The keys a transformer method returns.
 *
 * `followed` says whether a call inside the literal is a body the graph walks —
 * `AutorTransformer.transform(x)`, `this.toObject()` — in which case its keys
 * arrive through that body and the key holding it is not a DET of its own: the
 * user sees the author's name, not an "autor" field.
 *
 *   { titulo: l.titulo }                 1 — `titulo`
 *   { autor: AutorTransformer.transform } 0 here; the nested body contributes
 *   { endereco: { rua, cidade } }        leaves individually
 *   { tags: xs.map((t) => t.nome) }      1 — a repeating group of one attribute
 *   { itens: xs.map((i) => ({ a, b })) } the leaves, once
 *   ...this.pick(this.resource, [...])   the listed names
 *   ...this.toObject()                   0 here; the followed body contributes
 *   ...anythingElse                      1, opaque, reported
 *
 * A key that is the identifier of the transformer's resource is not a DET, for
 * the same reason `isPrimary` is not one on the data function.
 */
export function outputFieldsIn(
  body: Node,
  owner: ClassDeclaration | undefined,
  stores: Map<string, CollectedDataStore>,
  followed: (call: CallExpression) => boolean
): OutputFacts {
  if (!owner || !isTransformerClass(owner)) {
    return { outputs: [], opaqueOutputs: [], resource: null }
  }

  const qualifier = owner.getName() ?? 'Transformer'
  const resource = transformerResourceOf(owner)
  /**
   * The resource's key and its system timestamps: re-emitted for links and
   * sorting, and not something the user recognises — the same two exclusions the
   * data function applies (§6).
   */
  const excluded = new Set(
    (resource ? stores.get(resource)?.attributes : undefined)
      ?.filter((attribute) => attribute.isIdentifier || attribute.system)
      .map((attribute) => attribute.name) ?? []
  )

  const outputs = new Set<string>()
  const opaque = new Set<string>()

  const leaf = (prefix: string, name: string) => {
    if (prefix === '' && excluded.has(name)) return
    outputs.add(`${qualifier}.${prefix ? `${prefix}.${name}` : name}`)
  }

  const walk = (literal: ObjectLiteralExpression, prefix: string) => {
    for (const property of literal.getProperties()) {
      if (Node.isShorthandPropertyAssignment(property)) {
        leaf(prefix, property.getName())
        continue
      }

      if (Node.isMethodDeclaration(property) || Node.isGetAccessorDeclaration(property)) {
        leaf(prefix, property.getName())
        continue
      }

      if (Node.isSpreadAssignment(property)) {
        spread(property.getExpression(), prefix)
        continue
      }

      if (!Node.isPropertyAssignment(property)) continue

      const name = property.getName().replace(/^['"]|['"]$/g, '')
      const value = unwrap(property.getInitializer())
      if (!value) {
        leaf(prefix, name)
        continue
      }

      if (Node.isObjectLiteralExpression(value)) {
        walk(value, prefix ? `${prefix}.${name}` : name)
        continue
      }

      // a nested transformer: its keys come through the body the graph follows
      if (Node.isCallExpression(value) && followed(value)) continue

      // `xs.map((x) => ({ a, b }))`: a repeating group, its leaves counted once
      const mapped = mappedLiteralOf(value)
      if (mapped) {
        walk(mapped, prefix ? `${prefix}.${name}` : name)
        continue
      }

      leaf(prefix, name)
    }
  }

  const spread = (expression: Expression, prefix: string) => {
    const value = unwrap(expression)
    if (!value) return

    if (Node.isObjectLiteralExpression(value)) {
      walk(value, prefix)
      return
    }

    // `...(cond ? { a } : { b })`: the transaction can carry either, so the union
    if (Node.isConditionalExpression(value)) {
      spread(value.getWhenTrue(), prefix)
      spread(value.getWhenFalse(), prefix)
      return
    }

    if (Node.isCallExpression(value)) {
      const picked = pickedNamesOf(value)
      if (picked) {
        for (const name of picked) leaf(prefix, name)
        return
      }

      // `...this.toObject()`: the followed body contributes its own keys
      if (followed(value)) return
    }

    /**
     * `...this.resource.serialize()`, `...this.extras`: whatever the model has.
     * One DET as a floor, and reported — the placeholder carries the expression
     * so the report can name what could not be read.
     */
    const placeholder = `${qualifier}.${prefix ? `${prefix}.` : ''}<${value.getText().replace(/\s+/g, '')}>`
    outputs.add(placeholder)
    opaque.add(placeholder)
  }

  for (const literal of returnedLiteralsOf(body)) walk(literal, '')

  return {
    outputs: [...outputs],
    opaqueOutputs: [...opaque],
    resource: resource && stores.has(resource) ? resource : null,
  }
}

/**
 * Object literals the body itself returns — not the ones returned by arrow
 * functions inside it, which belong to `.map()` callbacks and are read as
 * repeating groups where they occur.
 */
function returnedLiteralsOf(body: Node): ObjectLiteralExpression[] {
  const literals: ObjectLiteralExpression[] = []

  for (const statement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const enclosing = statement.getFirstAncestor(
      (node) =>
        Node.isArrowFunction(node) ||
        Node.isFunctionExpression(node) ||
        Node.isMethodDeclaration(node) ||
        Node.isFunctionDeclaration(node)
    )
    if (enclosing !== body) continue

    const value = unwrap(statement.getExpression())
    if (value && Node.isObjectLiteralExpression(value)) literals.push(value)
  }

  return literals
}

/** `this.pick(this.resource, ['a', 'b'])` -> ['a', 'b']; null when it is not that call */
function pickedNamesOf(call: CallExpression): string[] | null {
  const callee = call.getExpression()
  if (!Node.isPropertyAccessExpression(callee)) return null
  if (callee.getName() !== 'pick') return null
  if (callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) return null

  const list = call.getArguments()[1]?.asKind(SyntaxKind.ArrayLiteralExpression)
  if (!list) return null

  const names: string[] = []
  for (const element of list.getElements()) {
    const name = element.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
    if (name === undefined) return null
    names.push(name)
  }
  return names
}

/** `xs.map((x) => ({ a, b }))` -> the literal; null for a scalar map or anything else */
function mappedLiteralOf(value: Expression): ObjectLiteralExpression | null {
  if (!Node.isCallExpression(value)) return null

  const callee = value.getExpression()
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'map') return null

  const callback = value.getArguments()[0]
  if (!callback || !Node.isArrowFunction(callback)) return null

  const returned = unwrap(callback.getBody().asKind(SyntaxKind.Block) ? null : callback.getBody())
  if (returned && Node.isObjectLiteralExpression(returned)) return returned

  for (const statement of callback.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const expression = unwrap(statement.getExpression())
    if (expression && Node.isObjectLiteralExpression(expression)) return expression
  }
  return null
}

/** strips parentheses, `as`, `satisfies` and non-null assertions */
function unwrap(node: Node | undefined | null): Expression | null {
  let current: Node | undefined | null = node
  while (
    current &&
    (Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current))
  ) {
    current = current.getExpression()
  }
  return current && Node.isExpression(current) ? current : null
}

// ---------------------------------------------------------------------------
// `.select()`
// ---------------------------------------------------------------------------

/**
 * The columns a fluent chain names in `.select()`, walking UP from the access
 * the detector recognised (`Livro.query()`) through the chain it belongs to.
 *
 * Only calls on the chain itself qualify. A `q.select('nome')` inside a
 * `preload('autor', (q) => …)` callback narrows the related store, not this
 * one, and reading every descendant would have attributed it here.
 *
 * Both spellings count: `.select(['a', 'b'])` and `.select('a', 'b')`. Anything
 * that is not a string literal — a variable, a raw expression — is unreadable:
 * the store falls back to every column, and the chain is reported.
 */
/** methods that leave ONE derived scalar rather than rows */
const AGGREGATES = new Set(['count', 'countDistinct', 'exists', 'sum', 'avg', 'min', 'max'])

/**
 * The shape of the chain an access belongs to — read from the WHOLE chain, root
 * to end, because every call on it is detected as an access and each must reach
 * the same answer: `Livro.query().where(…).count()` is an aggregate whether the
 * detector is looking at `query` or at `count`.
 *
 *   whole      rows leave: every column of the store (unless a transformer covers it)
 *   select     only the columns named
 *   aggregate  `.count()`, `.exists()`: one derived scalar leaves, not the table
 */
export type ChainShape = {
  selected: string[]
  aggregate: boolean
  /** a `.select()` whose column list is not literal */
  unreadable: { line: number; expression: string }[]
}

export function chainShapeOf(access: CallExpression): ChainShape {
  const selected = new Set<string>()
  const unreadable: ChainShape['unreadable'] = []
  let aggregate = false

  const inspect = (call: CallExpression) => {
    const callee = call.getExpression()
    if (!Node.isPropertyAccessExpression(callee)) return
    const name = callee.getName()

    if (AGGREGATES.has(name)) aggregate = true
    if (name !== 'select') return

    const literal = literalColumnsOf(call)
    if (literal) for (const column of literal) selected.add(column)
    else
      unreadable.push({
        line: call.getStartLineNumber(),
        expression: call.getText().replace(/\s+/g, ''),
      })
  }

  // down to the root of the chain
  let node: Node | undefined = access
  for (let depth = 0; node && depth < 40; depth++) {
    if (Node.isCallExpression(node)) inspect(node)
    node =
      Node.isCallExpression(node) || Node.isPropertyAccessExpression(node)
        ? node.getExpression()
        : undefined
  }

  // and up to its end — only calls ON the chain, not a callback's own chain
  node = access
  for (let depth = 0; depth < 40; depth++) {
    const parent: Node | undefined = node.getParent()
    if (!parent) break

    if (Node.isAwaitExpression(parent) || Node.isParenthesizedExpression(parent)) {
      node = parent
      continue
    }

    if (!Node.isPropertyAccessExpression(parent) || parent.getExpression() !== node) break

    const call = parent.getParent()
    if (!call || !Node.isCallExpression(call) || call.getExpression() !== parent) break

    inspect(call)
    node = call
  }

  return { selected: [...selected], aggregate, unreadable }
}

/** string-literal columns of one `.select(...)`; null when any is not a literal */
function literalColumnsOf(call: CallExpression): string[] | null {
  const columns: string[] = []

  const read = (node: Node): boolean => {
    const value = node.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
    if (value === undefined) return false
    // `livros.titulo` and `livros.*` are qualified; `*` names everything, which narrows nothing
    const bare = value.includes('.') ? value.split('.').pop()! : value
    if (bare !== '*') columns.push(camelCase(bare))
    return true
  }

  for (const argument of call.getArguments()) {
    const list = argument.asKind(SyntaxKind.ArrayLiteralExpression)
    if (list) {
      for (const element of list.getElements()) if (!read(element)) return null
      continue
    }
    if (!read(argument)) return null
  }

  return columns
}

/** `created_at` -> `createdAt`, to match the model's attribute names */
const camelCase = (value: string) =>
  value.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
