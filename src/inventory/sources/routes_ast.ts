import { Node, Project, SyntaxKind } from 'ts-morph'
import type { CallExpression, ObjectLiteralExpression, SourceFile } from 'ts-morph'

import type { AppContext } from '../app_context.js'
import type { EntryPoint, HandlerRef, UnresolvedCall } from '../../types.js'

/**
 * Lê os pontos de entrada HTTP a partir do AST dos arquivos de rota.
 *
 * No v7 o runtime é a fonte primária (`router.toJSON()` depois do boot), mas
 * este parser é o que se constrói e testa primeiro: fixtures não bootam, e a
 * invariante de ouro depende de uma app sem nenhum artefato gerado.
 *
 * Armadilhas já pagas, cada uma com regressão:
 *
 *   router            rota multi-linha: o texto da expressão contém a quebra,
 *     .post(...)      e sem normalizar o casamento falha em ~86% das rotas
 *
 *   .resource(p, C)   expande para até 7 rotas, filtradas por .only()/.apiOnly()
 *   .group().prefix() o prefixo tem que chegar ao padrão final, e acumula
 *   controllers.a.B   nome simples colide entre módulos: resolve pelo caminho
 *   router.on(p)      ponto de entrada sem handler nenhum
 */

export type CollectedEntryPoint = EntryPoint & {
  /** chave estável entre versões — counting-decisions §5 */
  identity: string
}

export type EntryPointCollection = {
  entryPoints: CollectedEntryPoint[]
  unresolved: UnresolvedCall[]
}

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'any'])

/** ação de resource -> verbo e sufixo de caminho */
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

      // `router.on(path)` não recebe handler: é apresentação estática
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
// reconhecimento da chamada
// ---------------------------------------------------------------------------
/**
 * `router.get`, mesmo quebrado em várias linhas.
 *
 * Normalizar o whitespace é o que separa enxergar 23 rotas de enxergar 164.
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
 * Métodos encadeados APÓS uma chamada: `.prefix('/x')`, `.as('y')`,
 * `.only([...])`.
 *
 * Tem que ser estrutural, nunca por regex no texto do statement. O texto de um
 * grupo externo contém os grupos aninhados dentro dele, e o `.prefix()` do
 * interno aparece ANTES do próprio — a primeira ocorrência é a errada. Foi
 * exatamente o bug que produziu `/trash/trash/books` no lugar de
 * `/admin/trash/books`.
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
 * Prefixo acumulado dos grupos que envolvem esta chamada.
 *
 * `.prefix()` é aplicado ao grupo, depois do callback — a informação está acima
 * no AST, não ao lado. Grupos aninhados acumulam de fora para dentro.
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
 * Nome da rota: `.as()` da própria chamada, prefixado pelos `.as()` dos grupos.
 *
 * O AdonisJS compõe `grupo.rota`, então um `.as('admin')` no grupo faz
 * `books.index` virar `admin.books.index`.
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

/** `['index', 'show']` como lista de strings, direto do AST */
function arrayOf(node: Node | undefined): string[] | null {
  const array = node?.asKind(SyntaxKind.ArrayLiteralExpression)
  if (!array) return null
  return array
    .getElements()
    .map((element) => literalOf(element))
    .filter((value): value is string => value !== null)
}

// ---------------------------------------------------------------------------
// resolução do handler
// ---------------------------------------------------------------------------
/**
 * Resolve `[Controller, 'method']` para arquivo e método.
 *
 * Duas formas convivem na mesma app: alias local por lazy import
 * (`const X = () => import('...')`) e o mapa gerado (`controllers.mod.Name`,
 * possivelmente desestruturado). O mapa é indexado pelo CAMINHO PONTUADO, não
 * pelo nome simples — numa app real havia 5 colisões entre módulos.
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
    // closure inline: o handler é o próprio corpo, ali mesmo
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
        problem: problemAt(call, handlerArg?.getText() ?? '?', 'handler não reconhecido'),
      }
    }

    const specifier = specifierFor(reference, lazyImports, destructured, controllers)
    if (!specifier) {
      return { handler: null, problem: problemAt(call, reference, 'controller não resolvido') }
    }

    const target = app.resolveSpecifier(specifier)
    if (!target) {
      return {
        handler: null,
        problem: problemAt(call, reference, `caminho não resolvido: ${specifier}`),
      }
    }

    return { handler: { file: target, member } as HandlerRef, problem: null }
  }
}

/**
 * `({ response }) => …` ou `function (ctx) { … }` passados direto na rota.
 *
 * Não é "controller não resolvido": é handler com corpo, e classificá-lo como
 * pendência perderia a transação inteira e ainda apontaria o motivo errado.
 */
function isInlineHandler(node: Node): boolean {
  return Node.isArrowFunction(node) || Node.isFunctionExpression(node)
}

/** `[X, 'method']`, `[X]` ou `X` */
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

/** mapa gerado, indexado pelo caminho pontuado completo */
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
 * `/books/:id` e `/books/:uuid` são a mesma função para o usuário.
 *
 * Sem isso, renomear um parâmetro viraria exclusão + inclusão no `fp:diff` e
 * faturaria em dobro — counting-decisions §5.
 */
const anonymizeParams = (pattern: string) => pattern.replace(/:[A-Za-z_][\w]*/g, ':param')

const problemAt = (call: CallExpression, expression: string, reason: string): UnresolvedCall => ({
  file: call.getSourceFile().getFilePath(),
  line: call.getStartLineNumber(),
  expression,
  reason,
})
