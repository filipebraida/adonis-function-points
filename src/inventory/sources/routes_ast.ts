import { Node, Project, SyntaxKind } from 'ts-morph'
import type { CallExpression, ObjectLiteralExpression, SourceFile } from 'ts-morph'

import type { AppContext } from '../app_context.js'
import type { EntryPoint, HandlerRef, UnresolvedCall } from '../../types.js'

/**
 * Reads the HTTP entry points from the AST of the route files.
 *
 * On v7 the runtime is the primary source (`router.toJSON()` after boot), but
 * this parser is what has to work first: fixtures do not boot, and the golden
 * invariant depends on an application with no generated artefact at all.
 *
 * Traps, each one covered by a regression test:
 *
 *   router            multi-line route: the expression text contains the line
 *     .post(...)      break, and without normalising it most routes never match
 *
 *   .resource(p, C)   expands to up to 7 routes, filtered by .only()/.apiOnly()
 *   .group().prefix() the prefix must reach the final pattern, and accumulates
 *   controllers.a.B   the bare name collides across modules: resolve by path
 *   router.on(p)      entry point with no handler at all
 */

export type CollectedEntryPoint = EntryPoint & {
  /** key that stays stable across versions — counting-decisions §5 */
  identity: string
}

export type EntryPointCollection = {
  entryPoints: CollectedEntryPoint[]
  unresolved: UnresolvedCall[]
}

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'any'])

/** resource action -> verb and path suffix */
const RESOURCE_ACTIONS: Record<string, { verb: string; suffix: string }> = {
  index: { verb: 'GET', suffix: '' },
  create: { verb: 'GET', suffix: '/create' },
  store: { verb: 'POST', suffix: '' },
  show: { verb: 'GET', suffix: '/:id' },
  edit: { verb: 'GET', suffix: '/:id/edit' },
  update: { verb: 'PUT', suffix: '/:id' },
  destroy: { verb: 'DELETE', suffix: '/:id' },
}

const API_ACTIONS = ['index', 'store', 'show', 'update', 'destroy']

export async function collectEntryPoints(app: AppContext): Promise<EntryPointCollection> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  })

  const entryPoints: CollectedEntryPoint[] = []
  const unresolved: UnresolvedCall[] = []

  const controllers = app.generated.controllersMap
    ? readControllersMap(project, app.generated.controllersMap)
    : new Map<string, string>()

  for (const routeFile of app.routeFiles) {
    const file = project.addSourceFileAtPathIfExists(routeFile)
    if (!file) continue

    const resolver = handlerResolver(file, app, controllers)

    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const verb = verbOf(call)
      if (!verb) continue

      const prefix = prefixFor(call)
      const args = call.getArguments()
      const pattern = literalOf(args[0])
      if (pattern === null) continue

      if (verb === 'resource') {
        entryPoints.push(
          ...expandResource(call, prefix + pattern, args[1], resolver, app, unresolved)
        )
        continue
      }

      // `router.on(path)` takes no handler: it is static presentation
      if (verb === 'on') {
        entryPoints.push(describe('GET', prefix + pattern, null, call, app, nameOf(call)))
        continue
      }

      const { handler, problem } = resolver(args[1], call)
      if (problem) unresolved.push(problem)

      entryPoints.push(
        describe(verb.toUpperCase(), prefix + pattern, handler, call, app, nameOf(call))
      )
    }
  }

  return { entryPoints, unresolved }
}

// ---------------------------------------------------------------------------
// call recognition
// ---------------------------------------------------------------------------
/**
 * `router.get`, even when broken across several lines.
 *
 * Normalising the whitespace is what separates seeing a fraction of the routes
 * from seeing all of them.
 */
function verbOf(call: CallExpression): string | null {
  const text = call.getExpression().getText().replace(/\s+/g, '')
  const match = text.match(/^router\.(\w+)$/)
  if (!match) return null

  const verb = match[1]
  if (VERBS.has(verb) || verb === 'resource' || verb === 'on') return verb
  return null
}

/**
 * Methods chained AFTER a call: `.prefix('/x')`, `.as('y')`, `.only([...])`.
 *
 * This has to be structural, never a regex over the statement text. The text of
 * an outer group contains the groups nested inside it, and the inner
 * `.prefix()` appears BEFORE the outer one — so the first occurrence is the
 * wrong one, and `/admin/trash/books` comes out as `/trash/trash/books`.
 */
function chainOf(call: CallExpression): Map<string, Node[]> {
  const applied = new Map<string, Node[]>()
  let current: Node = call

  for (let depth = 0; depth < 40; depth++) {
    const access = current.getParent()
    if (!access || !Node.isPropertyAccessExpression(access)) break
    if (access.getExpression() !== current) break

    const invocation = access.getParent()
    if (!invocation || !Node.isCallExpression(invocation)) break

    if (!applied.has(access.getName())) applied.set(access.getName(), invocation.getArguments())
    current = invocation
  }

  return applied
}

/**
 * Prefix accumulated from the groups enclosing this call.
 *
 * `.prefix()` is applied to the group, after the callback — the information
 * sits ABOVE in the AST, not beside it. Nested groups accumulate outside in.
 */
function prefixFor(call: CallExpression): string {
  const prefixes: string[] = []
  let current: Node = call

  for (let depth = 0; depth < 20; depth++) {
    const group = current
      .getAncestors()
      .find(
        (ancestor): ancestor is CallExpression =>
          Node.isCallExpression(ancestor) &&
          ancestor.getExpression().getText().replace(/\s+/g, '') === 'router.group'
      )
    if (!group) break

    const declared = literalOf(chainOf(group).get('prefix')?.[0])
    if (declared) prefixes.unshift(normalizePrefix(declared))

    current = group
  }

  return prefixes.join('')
}

const normalizePrefix = (value: string) => {
  const trimmed = value.replace(/\/+$/, '')
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * Route name: the call's own `.as()`, prefixed by the groups' `.as()`.
 *
 * AdonisJS composes `group.route`, so an `.as('admin')` on the group turns
 * `books.index` into `admin.books.index`.
 */
function nameOf(call: CallExpression): string | undefined {
  const own = literalOf(chainOf(call).get('as')?.[0])
  if (!own) return undefined

  const groups: string[] = []
  let current: Node = call

  for (let depth = 0; depth < 20; depth++) {
    const group = current
      .getAncestors()
      .find(
        (ancestor): ancestor is CallExpression =>
          Node.isCallExpression(ancestor) &&
          ancestor.getExpression().getText().replace(/\s+/g, '') === 'router.group'
      )
    if (!group) break

    const declared = literalOf(chainOf(group).get('as')?.[0])
    if (declared) groups.unshift(declared)

    current = group
  }

  return [...groups, own].join('.')
}

function literalOf(node: Node | undefined): string | null {
  return node?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue() ?? null
}

// ---------------------------------------------------------------------------
// resource
// ---------------------------------------------------------------------------
function expandResource(
  call: CallExpression,
  base: string,
  handlerArg: Node | undefined,
  resolve: ReturnType<typeof handlerResolver>,
  app: AppContext,
  unresolved: UnresolvedCall[]
): CollectedEntryPoint[] {
  const chain = chainOf(call)

  let actions = Object.keys(RESOURCE_ACTIONS)
  const only = arrayOf(chain.get('only')?.[0])
  const except = arrayOf(chain.get('except')?.[0])

  if (only) actions = only
  else if (chain.has('apiOnly')) actions = API_ACTIONS
  if (except) actions = actions.filter((action) => !except.includes(action))

  const { handler, problem } = resolve(handlerArg, call)
  if (problem) unresolved.push(problem)

  const name = nameOf(call)

  return actions
    .filter((action) => RESOURCE_ACTIONS[action])
    .map((action) => {
      const { verb, suffix } = RESOURCE_ACTIONS[action]
      return describe(
        verb,
        base + suffix,
        handler ? { ...handler, member: action } : null,
        call,
        app,
        name ? `${name}.${action}` : undefined
      )
    })
}

/** `['index', 'show']` as a list of strings, straight from the AST */
function arrayOf(node: Node | undefined): string[] | null {
  const array = node?.asKind(SyntaxKind.ArrayLiteralExpression)
  if (!array) return null
  return array
    .getElements()
    .map((element) => literalOf(element))
    .filter((value): value is string => value !== null)
}

// ---------------------------------------------------------------------------
// handler resolution
// ---------------------------------------------------------------------------
/**
 * Resolves `[Controller, 'method']` to a file and a method.
 *
 * Two forms coexist in the same application: a local alias via lazy import
 * (`const X = () => import('...')`) and the generated map (`controllers.mod.Name`,
 * possibly destructured). The map is indexed by the DOTTED PATH, not by the
 * bare name — modular applications routinely have several controllers sharing a
 * name across modules.
 */
function handlerResolver(file: SourceFile, app: AppContext, controllers: Map<string, string>) {
  const lazyImports = new Map<string, string>()
  const destructured = new Map<string, string>()

  for (const declaration of file.getVariableDeclarations()) {
    const initializer = declaration.getInitializer()
    const text = initializer?.getText().replace(/\s+/g, '') ?? ''

    const lazy = text.match(/import\(['"]([^'"]+)['"]\)/)
    if (lazy && Node.isIdentifier(declaration.getNameNode())) {
      lazyImports.set(declaration.getName(), lazy[1])
      continue
    }

    // const { catalog, admin } = controllers
    const binding = declaration.getNameNode().asKind(SyntaxKind.ObjectBindingPattern)
    if (binding && text.startsWith('controllers')) {
      const base = text === 'controllers' ? '' : text.replace(/^controllers\.?/, '')
      for (const element of binding.getElements()) {
        destructured.set(
          element.getName(),
          base ? `${base}.${element.getName()}` : element.getName()
        )
      }
    }
  }

  return (handlerArg: Node | undefined, call: CallExpression) => {
    // inline closure: the handler is the body itself, right there
    if (handlerArg && isInlineHandler(handlerArg)) {
      return {
        handler: {
          file: call.getSourceFile().getFilePath(),
          line: handlerArg.getStartLineNumber(),
        } as HandlerRef,
        problem: null,
      }
    }

    const { reference, member } = referenceOf(handlerArg)
    if (!reference) {
      return {
        handler: null,
        problem: problemAt(call, handlerArg?.getText() ?? '?', 'unrecognised handler'),
      }
    }

    const specifier = specifierFor(reference, lazyImports, destructured, controllers)
    if (!specifier) {
      return { handler: null, problem: problemAt(call, reference, 'unresolved controller') }
    }

    const target = app.resolveSpecifier(specifier)
    if (!target) {
      return {
        handler: null,
        problem: problemAt(call, reference, `unresolved path: ${specifier}`),
      }
    }

    return { handler: { file: target, member } as HandlerRef, problem: null }
  }
}

/**
 * `({ response }) => …` or `function (ctx) { … }` passed straight to the route.
 *
 * This is not "unresolved controller": it is a handler with a body, and filing
 * it as unresolved would lose the whole transaction and point at the wrong
 * reason as well.
 */
function isInlineHandler(node: Node): boolean {
  return Node.isArrowFunction(node) || Node.isFunctionExpression(node)
}

/** `[X, 'method']`, `[X]` or `X` */
function referenceOf(node: Node | undefined): { reference: string | null; member?: string } {
  if (!node) return { reference: null }

  const array = node.asKind(SyntaxKind.ArrayLiteralExpression)
  if (array) {
    const elements = array.getElements()
    return {
      reference: elements[0]?.getText().replace(/\s+/g, '') ?? null,
      member: literalOf(elements[1]) ?? undefined,
    }
  }

  return { reference: node.getText().replace(/\s+/g, '') }
}

function specifierFor(
  reference: string,
  lazyImports: Map<string, string>,
  destructured: Map<string, string>,
  controllers: Map<string, string>
): string | null {
  if (lazyImports.has(reference)) return lazyImports.get(reference)!

  if (reference.startsWith('controllers.')) {
    return controllers.get(reference.slice('controllers.'.length)) ?? null
  }

  const [head, ...rest] = reference.split('.')
  const base = destructured.get(head)
  if (base) {
    const key = rest.length > 0 ? `${base}.${rest.join('.')}` : base
    return controllers.get(key) ?? null
  }

  return null
}

/** generated map, indexed by the full dotted path */
function readControllersMap(project: Project, file: string): Map<string, string> {
  const map = new Map<string, string>()
  const source = project.addSourceFileAtPathIfExists(file)
  if (!source) return map

  const root = source
    .getVariableDeclaration('controllers')
    ?.getInitializer()
    ?.asKind(SyntaxKind.ObjectLiteralExpression)
  if (!root) return map

  const walk = (object: ObjectLiteralExpression, prefix: string) => {
    for (const property of object.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue

      const key = property.getName().replace(/['"]/g, '')
      const dotted = prefix ? `${prefix}.${key}` : key
      const initializer = property.getInitializer()

      const nested = initializer?.asKind(SyntaxKind.ObjectLiteralExpression)
      if (nested) {
        walk(nested, dotted)
        continue
      }

      const specifier = initializer?.getText().match(/import\(['"]([^'"]+)['"]\)/)
      if (specifier) map.set(dotted, specifier[1])
    }
  }

  walk(root, '')
  return map
}

// ---------------------------------------------------------------------------
// montagem
// ---------------------------------------------------------------------------
function describe(
  verb: string,
  pattern: string,
  handler: HandlerRef | null,
  call: CallExpression,
  app: AppContext,
  name?: string
): CollectedEntryPoint {
  const signature = normalizePattern(pattern)
  const file = call.getSourceFile().getFilePath()

  return {
    id: `${verb} ${signature}`,
    kind: 'http',
    module: handler ? app.moduleOf(handler.file) : app.moduleOf(file),
    trigger: verb,
    signature,
    name,
    handler,
    identity: `${verb} ${anonymizeParams(signature)}`,
    provenance: { file, line: call.getStartLineNumber(), by: 'routes-ast' },
  }
}

const normalizePattern = (pattern: string) => {
  const withSlash = pattern.startsWith('/') ? pattern : `/${pattern}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash
}

/**
 * `/books/:id` and `/books/:uuid` are the same function to the user.
 *
 * Without this, renaming a parameter would read as a deletion plus an addition
 * in `fp:diff` and bill twice — counting-decisions §5.
 */
const anonymizeParams = (pattern: string) => pattern.replace(/:[A-Za-z_][\w]*/g, ':param')

const problemAt = (call: CallExpression, expression: string, reason: string): UnresolvedCall => ({
  file: call.getSourceFile().getFilePath(),
  line: call.getStartLineNumber(),
  expression,
  reason,
})
