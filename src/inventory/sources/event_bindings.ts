import { Node, Project, SyntaxKind } from 'ts-morph'
import type { ArrayLiteralExpression, Expression, SourceFile } from 'ts-morph'

import type { AppContext } from '../app_context.js'
import { toPosix } from '../paths.js'
import type { HandlerRef } from '../../types.js'

/**
 * Which listeners each event reaches.
 *
 * `events.OrderPlaced.dispatch(id)` in a handler is the user's click, and the
 * write happens in a listener. AFP §6.5.3 requires aggregating every path a
 * transaction reaches, so this is the same decision already taken for a job
 * dispatch: the effect belongs to the transaction that caused it, whatever
 * thread runs it.
 *
 * Without the binding the dispatch resolved to the event class, which declares
 * no `dispatch` of its own — it inherits `BaseEvent` — so the call was reported
 * as an unknown AND every read and write inside the listener went uncounted.
 * That is the worst pairing: the gap is visible and the number is short.
 *
 * The binding is declared, not conventional: `emitter.on(event, [listeners])`
 * in a preload file. It is therefore READ, never inferred from a name — the
 * same rule the subpath imports follow.
 */

/** event class file (POSIX) -> the listener bodies it reaches */
export type EventBindings = Map<string, HandlerRef[]>

/**
 * All these functions need of the application: how to resolve a specifier.
 *
 * Narrowed on purpose, so the resolver can ask the same question of a call site
 * without being handed the whole context — and so this file cannot start
 * depending on more of it by accident.
 */
type SpecifierResolver = Pick<AppContext, 'resolveSpecifier'>

/** the method a listener declares; AdonisJS calls `handle` unless told otherwise */
const LISTENER_METHOD = 'handle'

export function collectEventBindings(app: AppContext): EventBindings {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  })

  for (const root of app.scanRoots) project.addSourceFilesAtPaths(`${root}/**/*.ts`)

  const bindings: EventBindings = new Map()

  for (const file of project.getSourceFiles()) {
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression()
      if (!Node.isPropertyAccessExpression(expression)) continue
      if (expression.getName() !== 'on') continue

      const [event, handlers] = call.getArguments()
      if (!event || !handlers) continue

      const eventFile = resolveEventClass(event, file, app)
      if (!eventFile) continue

      const refs = listenersOf(handlers, file, app)
      if (refs.length === 0) continue

      bindings.set(eventFile, [...(bindings.get(eventFile) ?? []), ...refs])
    }
  }

  return bindings
}

/**
 * The event class a dispatch or a binding names.
 *
 * Two shapes reach here: the class imported directly, and the generated
 * registry (`events.OrderPlaced`), which is what `node ace make:event` produces
 * and therefore the common one. Exported because the resolver has to ask the
 * same question of a call site, and two implementations of "which event is
 * this" would drift.
 */
export function resolveEventClass(
  expression: Expression | Node,
  from: SourceFile,
  app: SpecifierResolver
): string | null {
  // `emitter.on(OrderPlaced, …)` — the class itself
  if (Node.isIdentifier(expression)) {
    const target = importedFrom(expression.getText(), from, app)
    return target ? toPosix(target) : null
  }

  // `events.OrderPlaced` — a key of the generated registry
  if (!Node.isPropertyAccessExpression(expression)) return null

  const root = expression.getExpression()
  if (!Node.isIdentifier(root)) return null

  const registry = importedFrom(root.getText(), from, app)
  if (!registry) return null

  return registryEntry(registry, expression.getName(), from.getProject(), app)
}

/** listener bodies named by the second argument of `emitter.on` */
function listenersOf(handlers: Node, from: SourceFile, app: SpecifierResolver): HandlerRef[] {
  const entries: Node[] = handlers.isKind(SyntaxKind.ArrayLiteralExpression)
    ? (handlers as ArrayLiteralExpression).getElements()
    : [handlers]

  const refs: HandlerRef[] = []

  for (const entry of entries) {
    /**
     * `[SomeListener, 'method']`: AdonisJS lets the binding name the method,
     * and taking `handle` on faith there would look for a body that is not
     * the one bound.
     */
    if (entry.isKind(SyntaxKind.ArrayLiteralExpression)) {
      const [target, member] = entry.getElements()
      const file = target ? listenerFile(target, from, app) : null
      if (!file) continue
      const named = member?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
      refs.push({ file, member: named ?? LISTENER_METHOD })
      continue
    }

    const file = listenerFile(entry, from, app)
    if (file) refs.push({ file, member: LISTENER_METHOD })
  }

  return refs
}

function listenerFile(entry: Node, from: SourceFile, app: SpecifierResolver): string | null {
  // `listeners.SendInvoice` — the generated registry, whose values are importers
  if (Node.isPropertyAccessExpression(entry)) {
    const root = entry.getExpression()
    if (!Node.isIdentifier(root)) return null

    const registry = importedFrom(root.getText(), from, app)
    return registry ? registryEntry(registry, entry.getName(), from.getProject(), app) : null
  }

  if (Node.isIdentifier(entry)) {
    const target = importedFrom(entry.getText(), from, app)
    return target ? toPosix(target) : null
  }

  return null
}

/** where a local identifier was imported from, resolved through the alias map */
function importedFrom(local: string, from: SourceFile, app: SpecifierResolver): string | null {
  for (const declaration of from.getImportDeclarations()) {
    const named = declaration
      .getNamedImports()
      .some((entry) => (entry.getAliasNode()?.getText() ?? entry.getName()) === local)
    const isDefault = declaration.getDefaultImport()?.getText() === local

    if (!named && !isDefault) continue
    return app.resolveSpecifier(declaration.getModuleSpecifierValue())
  }

  return null
}

/**
 * The file a key of a generated registry points at.
 *
 * Both shapes the generators emit are handled: a direct reference to an
 * imported class (`events.ts`) and a lazy importer (`listeners.ts`). They differ
 * per artefact and per framework version, and reading only one of them silently
 * lost half the graph.
 */
function registryEntry(
  registryFile: string,
  key: string,
  project: Project,
  app: SpecifierResolver
): string | null {
  const file =
    project.getSourceFile(registryFile) ?? project.addSourceFileAtPathIfExists(registryFile)
  if (!file) return null

  for (const declaration of file.getVariableDeclarations()) {
    const literal = declaration.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression)
    const property = literal?.getProperty(key)?.asKind(SyntaxKind.PropertyAssignment)
    const value = property?.getInitializer()
    if (!value) continue

    // `OrderPlaced: OrderPlaced` — resolved through this file's own imports
    if (Node.isIdentifier(value)) {
      const target = importedFrom(value.getText(), file, app)
      return target ? toPosix(target) : null
    }

    // `SendInvoice: () => import('#listeners/send_invoice')`
    const specifier = value
      .getFirstDescendantByKind(SyntaxKind.CallExpression)
      ?.getArguments()[0]
      ?.asKind(SyntaxKind.StringLiteral)
      ?.getLiteralValue()

    const target = specifier ? app.resolveSpecifier(specifier) : null
    return target ? toPosix(target) : null
  }

  return null
}
