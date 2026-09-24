import { createHash } from 'node:crypto'
import { Node, Project, SyntaxKind } from 'ts-morph'
import type { CallExpression, ClassDeclaration, SourceFile } from 'ts-morph'

import type { AppContext } from '../app_context.js'
import type { CollectedDataStore } from '../sources/data_stores.js'
import { detectAccess, rootSymbolOf } from '../detectors/lucid.js'
import type { RelationMap, StoreSymbols } from '../detectors/lucid.js'
import { BUILTIN_CALL_RESOLVERS, resolveCall } from '../resolvers/index.js'
import type { CallResolver, ResolverContext } from '../resolvers/types.js'
import type { HandlerRef, TraceStep, UnresolvedCall } from '../../types.js'

/**
 * The transaction → data function graph. It is the backbone of the count.
 *
 * Three of the four boundary decisions are settled here: a static route does
 * not count because it reaches no data; a route from a package likewise; a
 * model hook counts because it lies on the path. And AFP requires aggregating
 * ALL reachable paths:
 *
 *   "When the static code analyzer finds multiple optional paths in the context
 *    of a transaction, it shall consider these multiple optional paths to be
 *    part of the same transaction."  — AFP §6.5.3
 *
 * Traversal is at METHOD level, never at file level: a domain service holds
 * many writes, and asking about the file would mark everyone importing it as a
 * writer.
 */

export type ScopeEntry = {
  file: string
  member?: string
  /** hash of the normalised AST — counting-decisions §5 */
  bodyHash: string
}

export type Behavior = {
  writes: boolean
  /** data stores reached */
  touches: string[]
  /**
   * Declared input fields: `request.validateUsing(x)` resolved down to the
   * fields of the VineJS schema — counting-decisions §7.
   */
  inputFields: string[]
  trace: TraceStep[]
  /** bodies reached, for `fp:diff` */
  scope: ScopeEntry[]
  unresolved: UnresolvedCall[]
}

/**
 * Fields declared by the validators used in this body.
 *
 * `request.validateUsing(createBookValidator)` -> resolve the validator ->
 * count the leaves of the `vine.object`, per the table in counting-decisions §7:
 *
 *   scalar                           1
 *   nested object                    leaves counted individually
 *   array of scalar                  1  (repeating group)
 *   array of object                  leaves, counted once
 *   unresolved spread                0, and reported — never guessed
 */
function validatorFieldsIn(body: Node, file: SourceFile, app: AppContext): string[] {
  const fields: string[] = []

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression()
    if (!Node.isPropertyAccessExpression(expression)) continue
    if (expression.getName() !== 'validateUsing') continue

    const argument = call.getArguments()[0]
    if (!argument || !Node.isIdentifier(argument)) continue

    const name = argument.getText()
    const declaration = findValidator(name, file, app)
    if (!declaration) continue

    for (const leaf of leavesOf(declaration)) fields.push(`${name}.${leaf}`)
  }

  return fields
}

/** validator declaration: in this file, or imported from the application */
function findValidator(name: string, file: SourceFile, app: AppContext): Node | null {
  const local = file.getVariableDeclaration(name)?.getInitializer()
  if (local) return local

  for (const declaration of file.getImportDeclarations()) {
    const names = declaration.getNamedImports().map((named) => named.getName())
    if (!names.includes(name)) continue

    const target = app.resolveSpecifier(declaration.getModuleSpecifierValue())
    if (!target) continue

    const source = file.getProject().getSourceFile(target)
    const initializer = source?.getVariableDeclaration(name)?.getInitializer()
    if (initializer) return initializer
  }

  return null
}

/** leaves of a VineJS schema, per the table in §7 */
function leavesOf(node: Node): string[] {
  const object = node.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression)
  if (!object) return []

  const leaves: string[] = []

  const walk = (literal: typeof object, prefix: string) => {
    for (const property of literal.getProperties()) {
      // an unresolved spread counts 0: better missing than guessed
      if (!Node.isPropertyAssignment(property)) continue

      const name = property.getName().replace(/['"]/g, '')
      const text = property.getText()
      const nested = property.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression)

      // nested `vine.object({...})`: leaves count individually
      // `vine.array(vine.object({...}))`: repeating group, leaves counted once
      if (nested && /vine\.object/.test(text)) {
        walk(nested, prefix ? `${prefix}.${name}` : name)
        continue
      }

      leaves.push(prefix ? `${prefix}.${name}` : name)
    }
  }

  walk(object, '')
  return leaves
}

/** file name, to identify the unresolved call without dumping the full path */
const pathOf = (file: string) => file.split('/').pop()?.replace(/\.ts$/, '') ?? file

/** facts about a body, independent of who called it */
type BodyFacts = {
  accesses: { store: string; write: boolean }[]
  /** validators usados neste corpo */
  validators: string[]
  followUps: { ref: HandlerRef; by: string }[]
  unresolved: UnresolvedCall[]
  bodyHash: string
}

export type GraphOptions = {
  /** how far to follow from the handler; the default comes from configuration */
  maxDepth?: number
  /**
   * Custom strategies, added to the built-in ones and ordered by `order`.
   *
   * This is what makes tracing extensible: AdonisJS imposes no organisation
   * pattern, so a project with its own convention registers it here.
   */
  callResolvers?: CallResolver[]
}

const DEFAULT_MAX_DEPTH = 3

/**
 * Analyzer with state shared across handlers.
 *
 * The ts-morph `Project` and the symbol cache are expensive to build and
 * identical for every handler of the same application. Creating one per handler
 * multiplies the cost by the number of routes, which is the difference between
 * minutes and seconds on an application of a few hundred routes.
 */
export function createAnalyzer(
  app: AppContext,
  stores: CollectedDataStore[],
  options: GraphOptions = {}
) {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  })

  /**
   * Every file is loaded up front.
   *
   * Adding a file part-way through the analysis invalidates the TypeScript
   * program, and the next query to the checker rebuilds it — a cost paid once
   * per route, uniformly. Loading everything first trades N rebuilds for one.
   */
  for (const root of app.scanRoots) {
    project.addSourceFilesAtPaths(`${root}/**/*.ts`)
  }

  const storesByName = new Map(stores.map((store) => [store.name, store]))
  const relationsByStore: RelationMap = new Map(
    stores.map((store) => [store.name, store.relations])
  )
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH

  const resolvers = [...(options.callResolvers ?? []), ...BUILTIN_CALL_RESOLVERS].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100)
  )

  const files = new Map<string, SourceFile | null>()
  const sourceFile = (absPath: string): SourceFile | null => {
    if (!files.has(absPath)) {
      files.set(
        absPath,
        project.getSourceFile(absPath) ?? project.addSourceFileAtPathIfExists(absPath) ?? null
      )
    }
    return files.get(absPath) ?? null
  }

  /** imports per file, computed once */
  const importCache = new Map<string, Map<string, string>>()
  const importsFor = (file: SourceFile): Map<string, string> => {
    const key = file.getFilePath()
    let cached = importCache.get(key)
    if (!cached) {
      cached = importsOf(file, app)
      importCache.set(key, cached)
    }
    return cached
  }

  /**
   * Facts about a body: what it accesses and where it calls into.
   *
   * They are INDEPENDENT of the caller — only the decision to follow depends on
   * depth. Without this cache a shared service is re-analysed once per route
   * that reaches it, and the cost grows with routes × depth.
   */
  const factsCache = new Map<string, BodyFacts | null>()

  const factsFor = (ref: HandlerRef): BodyFacts | null => {
    const key = `${ref.file}#${ref.member ?? ref.line ?? '*'}`
    if (factsCache.has(key)) return factsCache.get(key) ?? null

    const facts = computeFacts(ref)
    factsCache.set(key, facts)
    return facts
  }

  function computeFacts(ref: HandlerRef): BodyFacts | null {
    const file = sourceFile(ref.file)
    if (!file) return null

    const body = findBody(file, ref)
    if (!body) return null

    const imports = importsFor(file)
    const injected = injectedFor(
      body.getFirstAncestorByKind(SyntaxKind.ClassDeclaration),
      file,
      app
    )
    const symbols = storeSymbolsFor(body, file, app, storesByName)

    const accesses: { store: string; write: boolean }[] = []
    const followUps: { ref: HandlerRef; by: string }[] = []
    const unresolved: UnresolvedCall[] = []
    const validators = validatorFieldsIn(body, file, app)

    for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const access = detectAccess(call, symbols, relationsByStore)
      if (access) {
        accesses.push({ store: access.store, write: access.mode === 'write' })
        // a table reached through a relation is read, never written by this access
        if (access.viaRelation) accesses.push({ store: access.viaRelation, write: false })
        continue
      }

      const context: ResolverContext = {
        file,
        depth: 0,
        imports,
        injected,
        dataStoresBySymbol: storesByName,
        resolveSpecifier: app.resolveSpecifier,
        sourceFile,
      }

      const resolved = resolveCall(call, context, resolvers)
      if (resolved) {
        for (const next of resolved.refs) followUps.push({ ref: next, by: resolved.by })
        continue
      }

      if (isWorthReporting(call, symbols, imports)) {
        unresolved.push({
          file: ref.file,
          line: call.getStartLineNumber(),
          expression: call.getExpression().getText().replace(/\s+/g, ''),
          reason: 'call that no strategy knew how to follow',
        })
      }
    }

    return { accesses, followUps, unresolved, validators, bodyHash: hashOf(body) }
  }

  return {
    analyze: (handler: HandlerRef) => run(handler),
    /** how many files the project loaded — used to prove it does not grow */
    fileCount: () => project.getSourceFiles().length,
  }

  function run(handler: HandlerRef): Behavior {
    const touches = new Set<string>()
    const inputFields = new Set<string>()
    const trace: TraceStep[] = []
    const scope: ScopeEntry[] = []
    const unresolved: UnresolvedCall[] = []
    const visited = new Set<string>()

    let writes = false

    const visit = (ref: HandlerRef, depth: number) => {
      const key = `${ref.file}#${ref.member ?? ref.line ?? '*'}`
      if (visited.has(key) || depth > maxDepth) return
      visited.add(key)

      const facts = factsFor(ref)
      if (!facts) {
        /**
         * The resolver got the file right, but the body is not there — an
         * inherited method from a package class, for example
         * (`Transformer.transform()` coming from `BaseTransformer`).
         *
         * Dropping it silently is the worst possible defect: the transaction
         * loses a path and nobody knows.
         */
        unresolved.push({
          file: ref.file,
          line: ref.line ?? 0,
          expression: `${pathOf(ref.file)}.${ref.member ?? 'handle'}`,
          reason: 'body not found in the resolved file: probably inherited from a package class',
        })
        return
      }

      let bodyWrites = false
      for (const access of facts.accesses) {
        touches.add(access.store)
        if (access.write) {
          bodyWrites = true
          writes = true
        }
      }

      unresolved.push(...facts.unresolved)
      for (const field of facts.validators) inputFields.add(field)

      trace.push({
        file: ref.file,
        member: ref.member,
        depth,
        by: ref.member ?? 'entry',
        writes: bodyWrites,
      })
      scope.push({ file: ref.file, member: ref.member, bodyHash: facts.bodyHash })

      if (depth >= maxDepth) return

      for (const followUp of facts.followUps) {
        const before = trace.length
        visit(followUp.ref, depth + 1)
        // registra quem resolveu o passo que acabou de entrar
        if (trace.length > before) trace[before].by = followUp.by
      }
    }

    visit(handler, 0)

    return {
      writes,
      touches: [...touches].sort(),
      inputFields: [...inputFields].sort(),
      trace,
      scope,
      unresolved,
    }
  }
}

/** Convenience for a single handler; for several, use `createAnalyzer`. */
export function analyzeHandler(
  app: AppContext,
  stores: CollectedDataStore[],
  handler: HandlerRef,
  options: GraphOptions = {}
): Behavior {
  return createAnalyzer(app, stores, options).analyze(handler)
}

// ---------------------------------------------------------------------------
// body to analyse
// ---------------------------------------------------------------------------
/**
 * Resolves a `HandlerRef` to the corresponding body.
 *
 * Three forms coexist: a named method, a single-action handler (`handle`), and
 * an inline closure declared on the route itself — the last one located by
 * line, because it has no name.
 */
function findBody(file: SourceFile, ref: HandlerRef): Node | null {
  if (ref.line !== undefined) {
    const inline = file
      .getDescendants()
      .find(
        (node) =>
          (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) &&
          node.getStartLineNumber() === ref.line
      )
    if (inline) return inline
  }

  if (ref.member) {
    for (const cls of file.getClasses()) {
      const method = cls.getMethod(ref.member)
      if (method) return method
    }
    const fn = file.getFunction(ref.member)
    if (fn) return fn
    return null
  }

  for (const cls of file.getClasses()) {
    const handle = cls.getMethod('handle')
    if (handle) return handle

    const publicMethods = cls.getMethods().filter((method) => !method.hasModifier('private'))
    if (publicMethods.length === 1) return publicMethods[0]
  }

  return null
}

// ---------------------------------------------------------------------------
// symbols that resolve to a data store
// ---------------------------------------------------------------------------
/**
 * Builds the symbol map valid INSIDE this body.
 *
 * It includes the models imported in the file and the local variables derived
 * from them: `const invite = await Invite.findOrFail(...)` makes `invite.save()`
 * count as a write to `Invite`.
 */
function storeSymbolsFor(
  body: Node,
  file: SourceFile,
  app: AppContext,
  stores: Map<string, CollectedDataStore>
): StoreSymbols {
  const symbols: StoreSymbols = new Map()

  for (const declaration of file.getImportDeclarations()) {
    const target = app.resolveSpecifier(declaration.getModuleSpecifierValue())
    if (!target) continue

    const local = declaration.getDefaultImport()?.getText()
    if (local && stores.has(local)) symbols.set(local, local)

    for (const named of declaration.getNamedImports()) {
      const binding = named.getAliasNode()?.getText() ?? named.getName()
      if (stores.has(named.getName())) symbols.set(binding, named.getName())
    }
  }

  // local variables derived from an already known store
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer()
    const name = declaration.getNameNode()
    if (!initializer || !Node.isIdentifier(name)) continue

    const root = rootSymbolOf(initializer)
    const store = root ? symbols.get(root) : undefined
    if (store) symbols.set(name.getText(), store)
  }

  // parameters carrying a store
  if (Node.isMethodDeclaration(body) || Node.isFunctionDeclaration(body)) {
    for (const parameter of body.getParameters()) {
      const typeNode = parameter.getTypeNode()
      const nameNode = parameter.getNameNode()

      // direct form: `expire(invite: Invite)`
      const typeName = typeNode?.getText()
      if (typeName && stores.has(typeName) && Node.isIdentifier(nameNode)) {
        symbols.set(nameNode.getText(), typeName)
        continue
      }

      /**
       * Named type: `handle(input: ExpireInviteInput)` with
       * `interface ExpireInviteInput { invite: Invite }`.
       *
       * Registers the PATH `input.invite`, because that is how the write
       * appears: `input.invite.save()`.
       */
      if (typeNode && Node.isIdentifier(nameNode)) {
        for (const [property, propertyType] of membersOfType(typeNode, file, app)) {
          if (stores.has(propertyType)) {
            symbols.set(`${nameNode.getText()}.${property}`, propertyType)
          }
        }
      }

      /**
       * Destructured form: `handle({ invite }: { invite: Invite })`.
       *
       * This is the dominant shape in the action-object pattern — the action
       * receives a named payload. Without it, `invite.save()` inside the action
       * does not count as a write, and the whole transaction becomes an EO
       * instead of an EI.
       */
      const binding = nameNode.asKind(SyntaxKind.ObjectBindingPattern)
      const literal = typeNode?.asKind(SyntaxKind.TypeLiteral)
      if (!binding || !literal) continue

      const propertyTypes = new Map<string, string>()
      for (const member of literal.getMembers()) {
        if (!Node.isPropertySignature(member)) continue
        const memberType = member.getTypeNode()?.getText()
        if (memberType) propertyTypes.set(member.getName(), memberType)
      }

      for (const element of binding.getElements()) {
        const property = element.getPropertyNameNode()?.getText() ?? element.getName()
        const resolved = propertyTypes.get(property)
        if (resolved && stores.has(resolved)) symbols.set(element.getName(), resolved)
      }
    }
  }

  return symbols
}

/**
 * Injected dependencies visible in the body: property name -> file.
 *
 * Two forms, both with the type annotated explicitly — `@inject()` does not
 * work without it:
 *
 *   constructor(protected billing: BillingService) {}
 *   private declare billing: BillingService
 *
 * Since the type is an imported identifier, it resolves through the same path
 * as any import. No type checker is needed.
 */
export function injectedFor(
  owner: ClassDeclaration | undefined,
  file: SourceFile,
  app: AppContext
): Map<string, string> {
  const injected = new Map<string, string>()
  if (!owner) return injected

  const register = (property: string, typeName: string | undefined) => {
    if (!typeName) return
    const target = resolveTypeToFile(typeName, file, app)
    if (target) injected.set(property, target)
  }

  for (const parameter of owner.getConstructors()[0]?.getParameters() ?? []) {
    register(parameter.getName(), parameter.getTypeNode()?.getText())
  }

  for (const property of owner.getProperties()) {
    register(property.getName(), property.getTypeNode()?.getText())
  }

  return injected
}

/** type identifier -> application file where it is declared */
function resolveTypeToFile(typeName: string, file: SourceFile, app: AppContext): string | null {
  const bare = typeName.replace(/<.*/, '').trim()

  for (const declaration of file.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue()

    if (declaration.getDefaultImport()?.getText() === bare) {
      return app.resolveSpecifier(specifier)
    }
    for (const named of declaration.getNamedImports()) {
      const binding = named.getAliasNode()?.getText() ?? named.getName()
      if (binding === bare) return app.resolveSpecifier(specifier)
    }
  }

  return null
}

/**
 * Members of a declared type: `interface X { a: A }` -> { a: 'A' }.
 *
 * Accepts an inline type literal and a named type declared in this file or
 * imported from the application. Anything else yields empty — no guessing.
 */
function membersOfType(typeNode: Node, file: SourceFile, app: AppContext): Map<string, string> {
  const members = new Map<string, string>()

  const collect = (node: Node) => {
    const holders = Node.isTypeLiteral(node)
      ? node.getMembers()
      : Node.isInterfaceDeclaration(node)
        ? node.getMembers()
        : []

    for (const member of holders) {
      if (!Node.isPropertySignature(member)) continue
      const memberType = member.getTypeNode()?.getText()
      if (memberType) members.set(member.getName(), memberType)
    }
  }

  if (Node.isTypeLiteral(typeNode)) {
    collect(typeNode)
    return members
  }

  if (!Node.isTypeReference(typeNode)) return members
  const name = typeNode.getTypeName().getText()

  const local = file.getInterface(name) ?? file.getTypeAlias(name)
  if (local) {
    collect(Node.isTypeAliasDeclaration(local) ? (local.getTypeNode() ?? local) : local)
    return members
  }

  for (const declaration of file.getImportDeclarations()) {
    const target = app.resolveSpecifier(declaration.getModuleSpecifierValue())
    if (!target) continue

    const names = declaration.getNamedImports().map((named) => named.getName())
    if (!names.includes(name)) continue

    const source = file.getProject().addSourceFileAtPathIfExists(target)
    const declared = source?.getInterface(name) ?? source?.getTypeAlias(name)
    if (declared) {
      collect(
        Node.isTypeAliasDeclaration(declared) ? (declared.getTypeNode() ?? declared) : declared
      )
    }
  }

  return members
}

function importsOf(file: SourceFile, app: AppContext): Map<string, string> {
  const map = new Map<string, string>()

  for (const declaration of file.getImportDeclarations()) {
    const target = app.resolveSpecifier(declaration.getModuleSpecifierValue())
    if (!target) continue

    const defaultImport = declaration.getDefaultImport()?.getText()
    if (defaultImport) map.set(defaultImport, target)
    for (const named of declaration.getNamedImports()) {
      map.set(named.getAliasNode()?.getText() ?? named.getName(), target)
    }
  }

  return map
}

// ---------------------------------------------------------------------------
// noise vs unresolved
// ---------------------------------------------------------------------------
/**
 * Not every unfollowed call is an unresolved call — but the filter must err on
 * the side of reporting.
 *
 * `response.redirect()` and `inertia.render()` lead to no data at all and would
 * only drown the report. But a call on a symbol imported from the APPLICATION
 * itself may hide a data access, and silencing it is the worst possible defect
 * here: the transaction becomes an EO and nobody knows.
 *
 * A filter that only reported `this.` would hide most of the real gap.
 */
function isWorthReporting(
  call: CallExpression,
  symbols: StoreSymbols,
  imports: Map<string, string>
): boolean {
  const expression = call.getExpression()

  // module function imported from the application: `expireInvite(...)`
  if (Node.isIdentifier(expression)) return imports.has(expression.getText())

  if (!Node.isPropertyAccessExpression(expression)) return false

  const root = rootSymbolOf(expression.getExpression())
  if (!root) return false

  // already accounted for as a data access
  if (symbols.has(root)) return false

  // `this.something()` may be an injected dependency — a known gap
  if (root === 'this') return true

  // a symbol of the application itself that no strategy followed
  return imports.has(root)
}

// ---------------------------------------------------------------------------
// scope hash
// ---------------------------------------------------------------------------
/**
 * Hash of the NORMALISED body: comments and whitespace removed.
 *
 * counting-decisions §5 measures modification by a checksum of the
 * implementation scope. If the hash were over the raw bytes, running Prettier
 * would turn into an invoice.
 */
function hashOf(body: Node): string {
  const normalized = body
    .getText()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, '')

  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}
