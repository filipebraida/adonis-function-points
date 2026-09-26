import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { Node, SyntaxKind } from 'ts-morph'
import type { Project, SourceFile } from 'ts-morph'

import type { RelationMap } from '../detectors/lucid.js'
import type { CollectedDataStore } from '../sources/data_stores.js'
import { toPosix } from '../paths.js'

/**
 * What the page SHOWS of a store handed to it raw — plan 0.7 §B / 0.8 §D,
 * counting-decisions §6.
 *
 * The delivery rule (§A′) says which store leaves; a transformer or a `.select()`
 * says which columns. With neither, the store left whole — and the CPM defines an
 * output's DETs by what the user sees. The page is TypeScript (`.tsx`) or Edge,
 * and the same reader that opened the controller can open it: from the
 * component's props to every member read off a row, one child component deep.
 *
 * Where it cannot read — a second level of components, a spread, a package's
 * component, two files answering to one page name — the store leaves whole and
 * the transaction is REPORTED with the reason. Overestimating in the open, never a
 * floor: a floor would undercount what the user sees.
 */

export type PageRef = { engine: 'inertia' | 'edge'; page: string }
/** a store handed raw to a page, at a key path of its props (`vagas.data`) */
export type RawDelivery = PageRef & { store: string; path: string }

export type PageReading = {
  /** store -> columns the page reads off its rows */
  columns: Map<string, Set<string>>
  /** store -> why the page could not be read for it (the store then leaves whole) */
  unreadable: Map<string, string>
  /** store -> members the page reads that are NOT its columns (`inventor.nomeCompleto`, computed on the way) */
  unknownMembers: Map<string, Set<string>>
}

export type PageEnvironment = {
  root: string
  project: Project
  stores: Map<string, CollectedDataStore>
  relations: RelationMap
  /** the application's subpath imports (`#tecnologias/ui/components/x`), as the graph resolves them */
  resolveSpecifier: (specifier: string) => string | null
}

/** array methods whose callback receives one row */
const ITERATES_ROWS = new Set([
  'map',
  'forEach',
  'filter',
  'find',
  'findLast',
  'some',
  'every',
  'flatMap',
])
/** array methods that hand back one row, or the same rows */
const SAME_ROWS = new Set([
  'filter',
  'slice',
  'sort',
  'toSorted',
  'reverse',
  'concat',
  'flat',
  'find',
  'findLast',
  'at',
])
/** wrappers whose property hands the rows on */
const PASSES_THROUGH = new Set(['data', 'rows', 'all'])
/** how deep the reader follows a row into child components */
const MAX_COMPONENT_DEPTH = 1

/** an entity the page holds: rows (or a row) of a store, possibly still wrapped under key path `rest` */
type Entity = { store: string; rest: string[] }

export function readPages(deliveries: RawDelivery[], env: PageEnvironment): PageReading {
  const reading: PageReading = {
    columns: new Map(),
    unreadable: new Map(),
    unknownMembers: new Map(),
  }
  if (deliveries.length === 0) return reading

  const byPage = new Map<string, RawDelivery[]>()
  for (const delivery of deliveries) {
    const key = `${delivery.engine}:${delivery.page}`
    byPage.set(key, [...(byPage.get(key) ?? []), delivery])
  }

  for (const group of byPage.values()) {
    const { engine, page } = group[0]
    const candidates =
      engine === 'inertia' ? inertiaPageFiles(env.root, page) : edgeFiles(env.root, page)

    if (candidates.length !== 1) {
      const reason =
        candidates.length === 0
          ? `page "${page}" not found under the ${engine === 'inertia' ? 'pages' : 'views'} conventions`
          : `two files answer to the page "${page}": ${candidates.map((c) => toPosix(c).replace(`${toPosix(env.root)}/`, '')).join(', ')}`
      for (const delivery of group) markUnreadable(reading, delivery.store, reason)
      continue
    }

    /**
     * One prop carrying several stores — a query object whose unreadable result
     * made every store it read leave under `atuacao` — cannot be told apart by the
     * page: `atuacao.total` belongs to none of them. Whole, all of them, and said so.
     */
    const byPath = new Map<string, Set<string>>()
    for (const d of group) byPath.set(d.path, new Set([...(byPath.get(d.path) ?? []), d.store]))
    const readable = group.filter((d) => {
      const stores = byPath.get(d.path)!
      if (stores.size === 1) return true
      markUnreadable(
        reading,
        d.store,
        `page "${page}": prop \`${d.path || '(props)'}\` carries ${stores.size} stores (${[...stores].join(', ')}) — what the page reads off it belongs to no one of them`
      )
      return false
    })
    if (readable.length === 0) continue

    const reader = new PageReader(env, reading)
    if (engine === 'inertia') reader.readTsx(candidates[0], readable)
    else reader.readEdge(candidates[0], readable)

    /**
     * The page was read and no column of the store came out of it: either the page
     * never touches the rows, or it reads members that are not columns — a row the
     * controller serialised on the way, or computed getters. Whole, and said so.
     */
    for (const { store } of readable) {
      if (reading.columns.has(store) || reading.unreadable.has(store)) continue
      const members = [...(reading.unknownMembers.get(store) ?? [])]
      markUnreadable(
        reading,
        store,
        members.length > 0
          ? `page "${page}" reads ${members
              .slice(0, 4)
              .map((m) => `\`${m}\``)
              .join(', ')} off ${store}, none of them a column of it`
          : `page "${page}" never reads ${store}`
      )
    }
  }

  return reading
}

function markUnreadable(reading: PageReading, store: string, reason: string) {
  if (!reading.unreadable.has(store)) reading.unreadable.set(store, reason)
}

// ---------------------------------------------------------------------------
// finding the page
// ---------------------------------------------------------------------------

const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  'tmp',
  '.adonisjs',
])

/**
 * `inertia.render('livros/index')` → `inertia/pages/livros/index.tsx` (the default),
 * `app/<first>/ui/pages/<rest>.tsx` (a domain-module layout), or any `pages/` directory
 * under the root holding that path. The `resolve` function of the front-end is not
 * run — a convention is read, a function is not.
 */
function inertiaPageFiles(root: string, page: string): string[] {
  const found = new Set<string>()
  // `pedidos/show` → `app/pedidos/ui/pages/show.tsx`: the first segment names the module
  const [first, ...rest] = page.split('/')
  if (rest.length > 0) {
    for (const extension of ['.tsx', '.jsx', '.vue', '.svelte']) {
      const file = join(root, 'app', first, 'ui', 'pages', `${rest.join('/')}${extension}`)
      if (existsSync(file)) found.add(file)
    }
  }
  for (const dir of pagesDirectories(root)) {
    for (const extension of ['.tsx', '.jsx', '.vue', '.svelte']) {
      const file = join(dir, `${page}${extension}`)
      if (existsSync(file)) found.add(file)
      const index = join(dir, page, `index${extension}`)
      if (existsSync(index)) found.add(index)
    }
  }
  return [...found].sort()
}

let pagesDirsCache = new Map<string, string[]>()

function pagesDirectories(root: string): string[] {
  const cached = pagesDirsCache.get(root)
  if (cached) return cached
  const dirs: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIPPED_DIRS.has(entry) || entry.startsWith('.')) continue
      const full = join(dir, entry)
      let isDirectory = false
      try {
        isDirectory = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (!isDirectory) continue
      if (entry === 'pages') dirs.push(full)
      else walk(full, depth + 1)
    }
  }
  walk(root, 0)
  pagesDirsCache.set(root, dirs)
  return dirs
}

/** `view.render('catalogo')` → `resources/views/catalogo.edge` */
function edgeFiles(root: string, page: string): string[] {
  const file = join(root, 'resources', 'views', `${page.replace(/\./g, '/')}.edge`)
  return existsSync(file) ? [file] : []
}

/** tsconfig `paths` of the application, for the page's own imports (`~/components/x`) */
function aliasesOf(root: string): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const config of [join(root, 'tsconfig.json'), join(root, 'inertia', 'tsconfig.json')]) {
    if (!existsSync(config)) continue
    try {
      const text = readFileSync(config, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      const paths = JSON.parse(text)?.compilerOptions?.paths as Record<string, string[]> | undefined
      for (const [alias, targets] of Object.entries(paths ?? {})) {
        const target = targets[0]
        if (!target) continue
        aliases.set(alias.replace(/\*$/, ''), resolve(dirname(config), target.replace(/\*$/, '')))
      }
    } catch {
      // an unreadable tsconfig is the default's problem, below
    }
  }
  if (!aliases.has('~/')) aliases.set('~/', join(root, 'inertia'))
  return aliases
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

class PageReader {
  private readonly aliases: Map<string, string>

  constructor(
    private readonly env: PageEnvironment,
    private readonly reading: PageReading
  ) {
    this.aliases = aliasesOf(env.root)
  }

  // ---- TSX ---------------------------------------------------------------

  readTsx(file: string, deliveries: RawDelivery[]) {
    const source = this.env.project.addSourceFileAtPathIfExists(file)
    const component = source ? defaultComponentOf(source) : null
    if (!source || !component) {
      for (const d of deliveries)
        this.fail(
          d.store,
          `page "${deliveries[0].page}" has no default-exported component the reader can open`
        )
      return
    }
    const scope = this.bindProps(
      component,
      deliveries.map((d) => ({
        name: d.path.split('.')[0],
        entity: { store: d.store, rest: d.path.split('.').slice(1) },
      }))
    )
    this.readComponent(component, scope, 0, deliveries[0].page)
  }

  /** the component's first parameter: `{ livros }`, `{ livros: rows }`, or `props` */
  private bindProps(
    component: Node,
    props: { name: string; entity: Entity }[]
  ): Map<string, Entity> {
    const scope = new Map<string, Entity>()
    if (!Node.isParametered(component)) return scope
    const parameter = component.getParameters()[0]
    if (!parameter) return scope
    const nameNode = parameter.getNameNode()
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const property = element.getPropertyNameNode()?.getText() ?? element.getName()
        const prop = props.find((p) => p.name === property)
        if (prop) scope.set(element.getName(), prop.entity)
      }
    } else if (Node.isIdentifier(nameNode)) {
      // `props.livros`: the props object itself, every prop one segment down
      for (const prop of props) scope.set(`${nameNode.getText()}.${prop.name}`, prop.entity)
    }
    return scope
  }

  private readComponent(component: Node, scope: Map<string, Entity>, depth: number, page: string) {
    const body =
      Node.isParametered(component) && 'getBody' in component
        ? ((component as { getBody(): Node | undefined }).getBody() ?? component)
        : component
    const file = component.getSourceFile()

    /** the entity an expression holds, recording a column when the expression IS one */
    const entityOf = (node: Node | undefined, visiting = 0): Entity | null => {
      if (!node || visiting > 12) return null
      let current: Node = node
      while (
        Node.isParenthesizedExpression(current) ||
        Node.isNonNullExpression(current) ||
        Node.isAsExpression(current) ||
        Node.isAwaitExpression(current)
      )
        current = current.getExpression()

      if (Node.isIdentifier(current)) return scope.get(current.getText()) ?? null

      if (Node.isPropertyAccessExpression(current)) {
        const receiver = current.getExpression()
        // `props.livros` bound as a path
        if (Node.isIdentifier(receiver)) {
          const asPath = scope.get(`${receiver.getText()}.${current.getName()}`)
          if (asPath) return asPath
        }
        const holder = entityOf(receiver, visiting + 1)
        if (!holder) return null
        return this.member(holder, current.getName())
      }

      if (Node.isElementAccessExpression(current)) {
        const holder = entityOf(current.getExpression(), visiting + 1)
        if (!holder) return null
        const argument = current.getArgumentExpression()
        if (argument && Node.isStringLiteral(argument))
          return this.member(holder, argument.getLiteralValue())
        return holder // `rows[0]`: one row
      }

      if (Node.isCallExpression(current)) {
        const callee = current.getExpression()
        if (Node.isPropertyAccessExpression(callee)) {
          const holder = entityOf(callee.getExpression(), visiting + 1)
          if (holder && holder.rest.length === 0 && SAME_ROWS.has(callee.getName())) return holder
          if (holder && holder.rest.length === 0 && ITERATES_ROWS.has(callee.getName())) return null // rows consumed by the callback, bound below
          if (holder && holder.rest.length === 0 && callee.getName() === 'length') return null
          if (holder) return null
        }
        return null
      }

      if (Node.isConditionalExpression(current)) {
        entityOf(current.getCondition(), visiting + 1)
        return (
          entityOf(current.getWhenTrue(), visiting + 1) ??
          entityOf(current.getWhenFalse(), visiting + 1)
        )
      }
      if (Node.isBinaryExpression(current)) {
        const operator = current.getOperatorToken().getKind()
        // `a && b` renders b — a is a condition, read for its columns and never the value
        if (operator === SyntaxKind.AmpersandAmpersandToken) {
          entityOf(current.getLeft(), visiting + 1)
          return entityOf(current.getRight(), visiting + 1)
        }
        // `a ?? b`, `a || b`: either side is the value
        if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken)
          return (
            entityOf(current.getLeft(), visiting + 1) ?? entityOf(current.getRight(), visiting + 1)
          )
        // `a === b`, `a + b`: a value, never rows — both sides read for their columns
        entityOf(current.getLeft(), visiting + 1)
        entityOf(current.getRight(), visiting + 1)
        return null
      }
      // `${x.a} · ${x.b}`: the template's expressions are read for their columns
      if (Node.isTemplateExpression(current)) {
        for (const span of current.getTemplateSpans()) entityOf(span.getExpression(), visiting + 1)
        return null
      }
      return null
    }

    const escape = (entity: Entity, reason: string) => {
      const store = entity.rest.length === 0 ? entity.store : entity.store
      this.fail(store, `page "${page}": ${reason}`)
    }

    body.forEachDescendant((node) => {
      // `const { data } = vagas`, `const rows = vagas.data`, `const livro = livros[0]`
      if (Node.isVariableDeclaration(node)) {
        const initializer = node.getInitializer()
        const nameNode = node.getNameNode()
        if (!initializer) return
        const entity = entityOf(initializer)
        if (!entity) return
        if (Node.isIdentifier(nameNode)) scope.set(nameNode.getText(), entity)
        else if (Node.isObjectBindingPattern(nameNode)) {
          for (const element of nameNode.getElements()) {
            const property = element.getPropertyNameNode()?.getText() ?? element.getName()
            const member = this.member(entity, property)
            if (member) scope.set(element.getName(), member)
          }
        }
        return
      }

      // `livros.map((livro) => …)`: the callback's parameter is a row
      if (Node.isCallExpression(node)) {
        const callee = node.getExpression()
        if (Node.isPropertyAccessExpression(callee) && ITERATES_ROWS.has(callee.getName())) {
          const holder = entityOf(callee.getExpression())
          const callback = node.getArguments()[0]
          if (
            holder &&
            holder.rest.length === 0 &&
            callback &&
            (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback))
          ) {
            const parameter = callback.getParameters()[0]?.getNameNode()
            if (parameter && Node.isIdentifier(parameter)) scope.set(parameter.getText(), holder)
          }
          return
        }
        // `formatar(livro)`, `JSON.stringify(livro)`, `useState(livros)`: the row leaves the reader's sight
        for (const argument of node.getArguments()) {
          const entity = entityOf(argument)
          if (entity && !Node.isPropertyAccessExpression(unwrapParens(argument)))
            escape(
              entity,
              `\`${node.getExpression().getText()}(…)\` receives the rows and the reader cannot follow a function`
            )
          else if (entity)
            escape(
              entity,
              `\`${node.getExpression().getText()}(…)\` receives the rows and the reader cannot follow a function`
            )
        }
        return
      }

      if (Node.isForOfStatement(node)) {
        const declared = node.getInitializer()
        const entity = entityOf(node.getExpression())
        if (entity && Node.isVariableDeclarationList(declared)) {
          const nameNode = declared.getDeclarations()[0]?.getNameNode()
          if (nameNode && Node.isIdentifier(nameNode)) scope.set(nameNode.getText(), entity)
        }
        return
      }

      // `{...livro}` in a literal or `<X {...livro} />`: everything leaves
      if (
        Node.isSpreadAssignment(node) ||
        Node.isJsxSpreadAttribute(node) ||
        Node.isSpreadElement(node)
      ) {
        const entity = entityOf(node.getExpression())
        if (entity) escape(entity, 'a spread hands the whole row on')
        return
      }

      // `{livro.titulo}`: one column, recorded by entityOf; `{livro}` alone: the row itself, unreadable
      if (Node.isJsxExpression(node)) {
        const expression = node.getExpression()
        const parent = node.getParent()
        if (!expression || Node.isJsxAttribute(parent)) return
        const entity = entityOf(expression)
        if (entity)
          escape(
            entity,
            `\`{${expression.getText().replace(/\s+/g, ' ').slice(0, 60)}}\` renders the row itself`
          )
        return
      }

      // `<Ficha livro={livro} />`: one level into the child component
      if (Node.isJsxAttribute(node)) {
        const initializer = node.getInitializer()
        const value =
          initializer && Node.isJsxExpression(initializer) ? initializer.getExpression() : undefined
        const entity = entityOf(value)
        if (!entity) return
        const element = node.getFirstAncestor(
          (n) => Node.isJsxOpeningElement(n) || Node.isJsxSelfClosingElement(n)
        )
        const tag =
          element && (Node.isJsxOpeningElement(element) || Node.isJsxSelfClosingElement(element))
            ? element.getTagNameNode().getText()
            : ''
        if (!/^[A-Z]/.test(tag)) return // an intrinsic element's attribute (`src={x.url}`) is a column, handled above
        if (depth >= MAX_COMPONENT_DEPTH) {
          escape(
            entity,
            `\`<${tag} ${node.getNameNode().getText()}={…} />\` is a second level of components; the reader follows one`
          )
          return
        }
        const child = this.componentOf(tag, file)
        if (!child) {
          escape(entity, `\`<${tag} />\` is not a component of the application the reader can open`)
          return
        }
        const childScope = this.bindProps(child, [{ name: node.getNameNode().getText(), entity }])
        this.readComponent(child, childScope, depth + 1, page)
        return
      }

      if (Node.isReturnStatement(node) && depth === 0) {
        const expression = node.getExpression()
        if (
          expression &&
          !Node.isJsxElement(expression) &&
          !Node.isJsxFragment(expression) &&
          !Node.isJsxSelfClosingElement(expression) &&
          !Node.isParenthesizedExpression(expression)
        ) {
          const entity = entityOf(expression)
          if (entity)
            escape(
              entity,
              `\`return ${expression.getText().replace(/\s+/g, ' ').slice(0, 60)}\` hands the rows back as they came`
            )
        }
      }
    })
  }

  /** `entity.name`: one column (recorded), a relation (the target), a wrapper key, or nothing */
  private member(entity: Entity, name: string): Entity | null {
    if (entity.rest.length > 0) {
      return entity.rest[0] === name ? { store: entity.store, rest: entity.rest.slice(1) } : null
    }
    if (PASSES_THROUGH.has(name)) return entity
    const store = this.env.stores.get(entity.store)
    if (store?.attributes.some((a) => a.name === name)) {
      this.column(entity.store, name)
      return null
    }
    const target = this.env.relations.get(entity.store)?.[name]
    if (target) return { store: target, rest: [] }
    if (
      ![
        'length',
        'id',
        'map',
        'filter',
        'find',
        'some',
        'every',
        'forEach',
        'slice',
        'sort',
      ].includes(name)
    ) {
      const members = this.reading.unknownMembers.get(entity.store) ?? new Set<string>()
      members.add(name)
      this.reading.unknownMembers.set(entity.store, members)
    }
    return null
  }

  /** the component a JSX tag names, in this file or through its imports (tsconfig paths, relative) */
  private componentOf(tag: string, file: SourceFile): Node | null {
    const local = file.getFunction(tag) ?? functionVariable(file, tag)
    if (local) return local
    for (const declaration of file.getImportDeclarations()) {
      const names = [
        declaration.getDefaultImport()?.getText(),
        ...declaration.getNamedImports().map((n) => n.getAliasNode()?.getText() ?? n.getName()),
      ]
      if (!names.includes(tag)) continue
      const target = this.resolveImport(declaration.getModuleSpecifierValue(), file.getFilePath())
      if (!target) return null
      const source = this.env.project.addSourceFileAtPathIfExists(target)
      if (!source) return null
      const exported =
        declaration
          .getNamedImports()
          .find((n) => (n.getAliasNode()?.getText() ?? n.getName()) === tag)
          ?.getName() ?? tag
      return (
        source.getFunction(exported) ??
        functionVariable(source, exported) ??
        (declaration.getDefaultImport()?.getText() === tag ? defaultComponentOf(source) : null)
      )
    }
    return null
  }

  private resolveImport(specifier: string, from: string): string | null {
    let base: string | null = this.env.resolveSpecifier(specifier)
    if (base) base = base.replace(/\.(ts|tsx|js|jsx)$/, '')
    if (!base && specifier.startsWith('.')) base = resolve(dirname(from), specifier)
    else
      for (const [alias, dir] of this.aliases)
        if (specifier.startsWith(alias)) base = join(dir, specifier.slice(alias.length))
    if (!base) return null
    for (const candidate of [
      base,
      `${base}.tsx`,
      `${base}.ts`,
      `${base}.jsx`,
      join(base, 'index.tsx'),
      join(base, 'index.ts'),
    ])
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    return null
  }

  // ---- Edge ---------------------------------------------------------------

  readEdge(file: string, deliveries: RawDelivery[], depth = 0, scope?: Map<string, Entity>) {
    const text = readFileSync(file, 'utf8')
    const page = deliveries[0].page
    const bound = scope ?? new Map<string, Entity>()
    if (!scope)
      for (const d of deliveries)
        bound.set(d.path.split('.')[0], { store: d.store, rest: d.path.split('.').slice(1) })

    const entityOf = (expression: string): Entity | null => {
      const parts = expression.trim().replace(/\?\./g, '.').split('.')
      let entity = bound.get(parts[0]) ?? null
      for (const part of parts.slice(1)) {
        if (!entity) return null
        entity = this.member(entity, part.replace(/\(.*$/, ''))
      }
      return entity
    }
    const read = (expression: string) => {
      for (const chain of expression.match(/[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+/g) ?? []) {
        const entity = entityOf(chain)
        if (entity)
          this.fail(entity.store, `page "${page}": \`${chain}\` is a row handed on, not a column`)
      }
      // a bare identifier that IS the rows: `{{ livros }}`
      const bare = expression.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(bare) && bound.has(bare))
        this.fail(
          bound.get(bare)!.store,
          `page "${page}": \`{{ ${bare} }}\` renders the rows themselves`
        )
    }

    // `@each(livro in livros)`, `@each((livro, i) in livros)`
    for (const match of text.matchAll(
      /@each\(\s*\(?\s*([A-Za-z_$][\w$]*)(?:\s*,\s*[A-Za-z_$][\w$]*)?\s*\)?\s+in\s+([^)]+)\)/g
    )) {
      const entity = entityOf(match[2])
      if (entity) bound.set(match[1], entity)
    }
    for (const match of text.matchAll(/\{\{\{?\s*([\s\S]*?)\s*\}?\}\}/g)) read(match[1])
    for (const match of text.matchAll(/@(?:if|elseif|unless)\(([^)]*)\)/g)) read(match[1])

    // `@include('partials/x')`, `@component('x', { … })`: one level, same names in scope
    for (const match of text.matchAll(/@!?(?:include|component|layout)\(\s*['"]([^'"]+)['"]/g)) {
      const included = join(
        this.env.root,
        'resources',
        'views',
        `${match[1].replace(/\./g, '/')}.edge`
      )
      if (!existsSync(included)) continue
      if (depth >= MAX_COMPONENT_DEPTH) {
        for (const entity of bound.values())
          this.fail(
            entity.store,
            `page "${page}": \`@${match[0].slice(1).split('(')[0]}('${match[1]}')\` is a second level; the reader follows one`
          )
        continue
      }
      this.readEdge(included, deliveries, depth + 1, new Map(bound))
    }
  }

  // ---- results --------------------------------------------------------------

  private column(store: string, name: string) {
    const columns = this.reading.columns.get(store) ?? new Set<string>()
    columns.add(name)
    this.reading.columns.set(store, columns)
  }

  private fail(store: string, reason: string) {
    markUnreadable(this.reading, store, reason)
  }
}

function unwrapParens(node: Node): Node {
  let current = node
  while (Node.isParenthesizedExpression(current) || Node.isNonNullExpression(current))
    current = current.getExpression()
  return current
}

/** `export default function Page(…)`, or `export default Page` naming a function or an arrow */
function defaultComponentOf(file: SourceFile): Node | null {
  const declared = file.getFunctions().find((f) => f.isDefaultExport())
  if (declared) return declared
  for (const assignment of file.getExportAssignments()) {
    const expression = assignment.getExpression()
    if (Node.isIdentifier(expression))
      return file.getFunction(expression.getText()) ?? functionVariable(file, expression.getText())
    if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) return expression
    // `export default memo(Page)`, `withLayout(Page)`
    if (Node.isCallExpression(expression)) {
      const inner = expression.getArguments()[0]
      if (inner && Node.isIdentifier(inner))
        return file.getFunction(inner.getText()) ?? functionVariable(file, inner.getText())
    }
  }
  return null
}

/** `const Page = (props) => …` / `function (…) {}` */
function functionVariable(file: SourceFile, name: string): Node | null {
  const initializer = file.getVariableDeclaration(name)?.getInitializer()
  return initializer &&
    (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    ? initializer
    : null
}
