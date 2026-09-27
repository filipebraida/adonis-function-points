import { Node, Project, SyntaxKind } from 'ts-morph'
import type { ClassDeclaration, SourceFile, ClassExpression } from 'ts-morph'

import type { AppContext } from '../app_context.js'
import { samePath } from '../paths.js'
import type { Attribute, BoundaryKey, DataStore, UnresolvedCall } from '../../types.js'

/**
 * Collects the logical data stores — ILF/EIF candidates.
 *
 * The failure this module exists to make impossible: an application can hold
 * dozens of model files and ZERO `extends BaseModel` from Lucid, because the
 * models extend schema classes generated from migrations. Reading only the
 * model file would count zero for the whole application, **in silence**.
 *
 * The unit of work is therefore the INHERITANCE CHAIN, not the file:
 *
 *   class User extends BaseModel                        (direct)
 *   class User extends UserSchema                       (generated schema)
 *   class User extends compose(UserSchema, Auditable)   (mixin)
 *
 * Where the chain leaves the application — a mixin coming from a package —
 * collection stops and **reports**. A soft-delete mixin adds `deletedAt`;
 * pretending it does not exist would be counting wrong without warning.
 */

export type ColumnSource = 'ast' | 'generated-schema'

export type CollectedDataStore = DataStore & {
  /** where the columns came from; counts from different sources are not equivalent */
  columnSource: ColumnSource
  /** pivot table -> the related store, from `@manyToMany(() => X, { pivotTable })` or Lucid's default name */
  pivots: Record<string, string>
}

export type DataStoreCollection = {
  stores: CollectedDataStore[]
  /** chains that left the application, required by AFP §6.5.3 */
  unresolved: UnresolvedCall[]
  /**
   * Facts about the declarations that are not gaps: a base class or a mixin that
   * comes from a package. What it adds is technical (a hashed password, audit
   * stamps, a soft-delete mark) and never a user-recognisable attribute (§7.2); the
   * model's own columns and the schema decide. Listed, never counted in coverage.
   */
  notes: string[]
  /** tables declared in the boundary that neither a model nor the generated schema describes */
  undescribed: DeclaredTable[]
}

const LUCID_ORM = '@adonisjs/lucid/orm'
const BASE_MODEL = 'BaseModel'

/** decorators marking a composition relation — RET subgroup candidates */
const COMPOSITION_RELATIONS = new Set(['hasMany', 'hasOne'])

/** every Lucid relation decorator */
const ALL_RELATIONS = new Set(['belongsTo', 'hasMany', 'hasOne', 'manyToMany', 'hasManyThrough'])

/**
 * `declared`: tables the configuration names in a boundary key (plan 0.13 §B). One no
 * model reads becomes a store when the generated schema describes it — nobody writes a
 * model so that a counter can see a table; the structure is in the schema already, and
 * what the table IS is the configuration's to say.
 */
export async function collectDataStores(
  app: AppContext,
  declared: DeclaredTable[] = []
): Promise<DataStoreCollection> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  })

  for (const root of app.scanRoots) {
    project.addSourceFilesAtPaths(`${root}/**/*.ts`)
  }
  if (app.generated.dataSchema) project.addSourceFileAtPathIfExists(app.generated.dataSchema)

  const candidates: CollectedDataStore[] = []
  const unresolved: UnresolvedCall[] = []
  const notes: string[] = []

  /**
   * Classes appearing as an ANCESTOR of some model.
   *
   * A base class has no table; counting it invents a data store that does not
   * exist. Applications commonly define their own `BaseModel`, so this is the
   * normal case rather than an edge case.
   */
  const ancestors = new Set<string>()

  for (const file of project.getSourceFiles()) {
    // the generated file is a BASE for models, not a model itself
    if (samePath(file.getFilePath(), app.generated.dataSchema)) continue

    for (const cls of file.getClasses()) {
      const described = describeStore(cls, app, project, unresolved, notes)
      if (!described) continue

      candidates.push(described.store)
      for (const ancestor of described.ancestors) ancestors.add(ancestor)
    }
  }

  const stores = candidates.filter((store) => !ancestors.has(store.id))

  const undescribed: DeclaredTable[] = []
  const schema = app.generated.dataSchema
    ? project.getSourceFile(app.generated.dataSchema)
    : undefined
  for (const declaration of declared) {
    const known = stores.some(
      (store) => store.table === declaration.table || store.name === declaration.table
    )
    if (known) continue // a model's store: the key keeps the meaning it always had
    const cls = schema?.getClasses().find((c) => tablesOfSchemaClass(c).includes(declaration.table))
    const described = cls ? describeStore(cls, app, project, unresolved, notes) : null
    if (!cls || !described) {
      undescribed.push(declaration)
      continue
    }
    stores.push({
      ...described.store,
      id: `${described.store.id}@${declaration.table}`,
      name: cls.getName()!.replace(/Schema$/, ''),
      table: declaration.table,
      declaredIn: declaration.key,
    })
  }

  return { stores: stores.sort(byName), unresolved, notes, undescribed }
}

export type DeclaredTable = { table: string; key: BoundaryKey }

/**
 * The tables a generated-schema class may stand for. The generator names the class
 * after the table, singularised: `audits` -> `AuditSchema`, `authz_user_role` ->
 * `AuthzUserRoleSchema`, `categories` -> `CategorySchema`. Read back, the name is the
 * table with or without the plural.
 */
function tablesOfSchemaClass(cls: ClassDeclaration): string[] {
  const name = cls.getName()?.replace(/Schema$/, '')
  if (!name) return []
  const snake = name.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()
  return [snake, `${snake}s`, `${snake}es`, snake.replace(/y$/, 'ies')]
}

/** stable identity of a class, to separate a base from a store */
const classKey = (cls: ClassDeclaration) => `${cls.getSourceFile().getFilePath()}#${cls.getName()}`

const byName = (a: DataStore, b: DataStore) => a.name.localeCompare(b.name)

// ---------------------------------------------------------------------------
// one class -> one data store, if the chain leads to Lucid
// ---------------------------------------------------------------------------
function describeStore(
  cls: ClassDeclaration,
  app: AppContext,
  project: Project,
  unresolved: UnresolvedCall[],
  notes: string[]
): { store: CollectedDataStore; ancestors: string[] } | null {
  const name = cls.getName()
  if (!name) return null

  const chain = walkChain(cls, app, project)
  if (!chain.reachesLucid) return null

  unresolved.push(...chain.unresolved)
  notes.push(...chain.notes)
  const file = cls.getSourceFile().getFilePath()

  // the class itself is chain.classes[0]; the rest are ancestors
  const store: CollectedDataStore = {
    id: classKey(cls),
    name,
    module: app.moduleOf(file),
    table: tableOf(cls) ?? tableFromName(name),
    attributes: chain.attributes,
    subgroups: subgroupsOf(chain.classes),
    relations: relationsOf(chain.classes),
    pivots: pivotsOf(chain.classes, name),
    // decided by boundary configuration, not by heuristic
    maintainedExternally: false,
    columnSource: chain.columnSource,
    provenance: { file, line: cls.getStartLineNumber(), by: 'data-stores' },
  }

  return { store, ancestors: chain.classes.slice(1).map(classKey) }
}

type Chain = {
  /** does the chain reach Lucid's BaseModel? only then is it a data store */
  reachesLucid: boolean
  classes: ClassDeclaration[]
  attributes: Attribute[]
  columnSource: ColumnSource
  unresolved: UnresolvedCall[]
  /** bases and mixins from packages — facts, not gaps */
  notes: string[]
}

/**
 * Walks up the inheritance chain accumulating columns.
 *
 * `extends compose(A, B)` has more than one parent: both are followed. Anything
 * not resolvable inside the application becomes an unresolved entry — that is
 * not a detail, it is the difference between "has no column" and "I don't know
 * whether it has one".
 */
function walkChain(start: ClassDeclaration, app: AppContext, project: Project): Chain {
  const classes: ClassDeclaration[] = []
  const attributes = new Map<string, Attribute>()
  const seen = new Set<string>()

  /**
   * Unresolved entries stay local to the chain and only bubble up if the chain
   * really is a model's. Otherwise every application class extending something
   * from a package — controller, exception, middleware — would become noise in
   * the coverage report.
   */
  const unresolved: UnresolvedCall[] = []
  const notes: string[] = []
  let reachesLucid = false
  let columnSource: ColumnSource = 'ast'

  const visit = (cls: ClassDeclaration) => {
    const key = `${cls.getSourceFile().getFilePath()}#${cls.getName()}`
    if (seen.has(key)) return
    seen.add(key)
    classes.push(cls)

    if (samePath(cls.getSourceFile().getFilePath(), app.generated.dataSchema)) {
      columnSource = 'generated-schema'
    }

    for (const attribute of columnsOf(cls)) {
      if (!attributes.has(attribute.name)) attributes.set(attribute.name, attribute)
    }

    for (const parent of parentsOf(cls)) {
      const origin = originOf(parent.getText(), cls.getSourceFile())

      // did we reach Lucid?
      if (origin?.specifier === LUCID_ORM && origin.exportedName === BASE_MODEL) {
        reachesLucid = true
        continue
      }

      const resolved = resolveClass(parent.getText(), cls.getSourceFile(), app, project)
      if (resolved) {
        visit(resolved)
        continue
      }

      /**
       * A base or a mixin from a PACKAGE — `compose(Base, Auditable)` imported from
       * outside, `withAuthFinder(…)` inline or through a local const — is a fact about
       * the declaration, not a gap in the walk: nobody follows a mixin. What it adds is
       * technical (a hashed password, audit stamps) and never a user-recognisable
       * attribute (§7.2); the model's own columns and the schema decide. Noted, and kept
       * out of the coverage number. A base of the application that was not found stays
       * a gap.
       */
      /**
       * A mixin factory OF THE APPLICATION whose returned class declares no `@column`
       * adds methods, not attributes: a fact, not a gap. One that declares columns
       * stays a gap — reading them off the returned class is a rule for a release
       * that moves numbers (plan 0.11 §E).
       */
      const columnless = localFactoryWithoutColumns(parent, cls.getSourceFile(), app, project)
      if (columnless) {
        notes.push(
          `${cls.getName() ?? '?'}: local mixin factory ${columnless} declares no column — adds behaviour, not attributes`
        )
        continue
      }

      const packaged = packageOriginOf(parent, cls.getSourceFile(), app)
      if (packaged) {
        notes.push(
          `${cls.getName() ?? '?'}: base or mixin from ${packaged.specifier} (${packaged.expression}) — ` +
            `technical, adds no user-recognisable attribute; the model's own columns and the schema decide`
        )
        continue
      }

      unresolved.push({
        file: cls.getSourceFile().getFilePath(),
        line: parent.getStartLineNumber(),
        expression: parent.getText(),
        reason: reasonFor(parent, cls.getSourceFile(), app),
      })
    }
  }

  visit(start)

  return {
    reachesLucid,
    classes,
    attributes: [...attributes.values()],
    columnSource,
    unresolved,
    notes,
  }
}

/**
 * `compose(Base, withTracking())` where `withTracking` is a function of the application
 * whose body returns a class expression: the factory's name when that class declares no
 * `@column`, `null` when it declares one (or when the factory cannot be read).
 */
function localFactoryWithoutColumns(
  parent: Node,
  file: SourceFile,
  app: AppContext,
  project: Project
): string | null {
  if (!Node.isCallExpression(parent)) return null
  const callee = parent.getExpression()
  if (!Node.isIdentifier(callee)) return null
  const name = callee.getText()

  let declared = file.getFunction(name)
  if (!declared) {
    const origin = originOf(name, file)
    const target = origin ? app.resolveSpecifier(origin.specifier) : null
    const source = target
      ? (project.getSourceFile(target) ?? project.addSourceFileAtPathIfExists(target))
      : null
    declared =
      source?.getFunction(
        origin?.exportedName === 'default' ? name : (origin?.exportedName ?? name)
      ) ?? undefined
  }
  if (!declared) return null

  // `return class extends superclass {}` or `class WithSlug extends superclass {}; return WithSlug`
  const classes: (ClassExpression | ClassDeclaration)[] = [
    ...declared.getDescendantsOfKind(SyntaxKind.ClassExpression),
    ...declared.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
  ]
  const declaresColumn = classes.some((c) =>
    c.getProperties().some((p) => p.getDecorators().some((d) => /^column\b/.test(d.getFullName())))
  )
  return declaresColumn ? null : `${name}()`
}

/**
 * Where a base or a mixin comes from, when it comes from a package: the class
 * imported from a specifier the application does not resolve, a factory call whose
 * callee is, or a local const initialised by such a call.
 */
function packageOriginOf(
  parent: Node,
  file: SourceFile,
  app: AppContext
): { specifier: string; expression: string } | null {
  const fromPackage = (local: string) => {
    const origin = originOf(local, file)
    return origin && !app.resolveSpecifier(origin.specifier) ? origin.specifier : null
  }
  const rootOf = (node: Node): string | null => {
    let current: Node = node
    for (let depth = 0; depth < 20; depth++) {
      if (Node.isCallExpression(current) || Node.isPropertyAccessExpression(current)) {
        current = current.getExpression()
        continue
      }
      return Node.isIdentifier(current) ? current.getText() : null
    }
    return null
  }
  const brief = (text: string) => text.replace(/\s+/g, ' ').slice(0, 60)

  if (Node.isCallExpression(parent)) {
    const root = rootOf(parent)
    const specifier = root ? fromPackage(root) : null
    return specifier ? { specifier, expression: brief(parent.getText()) } : null
  }
  if (!Node.isIdentifier(parent)) return null

  const direct = fromPackage(parent.getText())
  if (direct) return { specifier: direct, expression: parent.getText() }

  const initializer = file.getVariableDeclaration(parent.getText())?.getInitializer()
  if (initializer && Node.isCallExpression(initializer)) {
    const root = rootOf(initializer)
    const specifier = root ? fromPackage(root) : null
    if (specifier)
      return { specifier, expression: `${parent.getText()} = ${brief(initializer.getText())}` }
  }
  return null
}

/**
 * Why the base class could not be resolved.
 *
 * The right reason matters as much as the fact: saying "outside the
 * application" about code that is inside it sends the reader to the wrong
 * place, and the coverage report exists precisely to be actionable.
 */
function reasonFor(parent: Node, file: SourceFile, app: AppContext): string {
  if (Node.isCallExpression(parent)) {
    return 'mixin factory: the column only exists on the class the function returns, and evaluating that return is beyond the current static analysis'
  }

  const origin = originOf(parent.getText(), file)
  if (origin && !app.resolveSpecifier(origin.specifier)) {
    return `base class outside the application (${origin.specifier}): the package cannot know which columns it adds`
  }

  return 'base class not found in the application'
}

/**
 * Parents of a class. `extends compose(A, B)` yields A and B; `extends X`
 * yields X.
 */
function parentsOf(cls: ClassDeclaration): Node[] {
  const extended = cls.getExtends()
  if (!extended) return []

  const expression = extended.getExpression()

  if (Node.isCallExpression(expression) && expression.getExpression().getText() === 'compose') {
    return expression.getArguments()
  }
  return [expression]
}

function resolveClass(
  name: string,
  from: SourceFile,
  app: AppContext,
  project: Project
): ClassDeclaration | null {
  const local = from.getClass(name)
  if (local) return local

  const origin = originOf(name, from)
  if (!origin) return null

  const target = app.resolveSpecifier(origin.specifier)
  if (!target) return null

  const file = project.getSourceFile(target) ?? project.addSourceFileAtPathIfExists(target)
  if (!file) return null

  // a default export may carry a different name from the local binding
  if (origin.exportedName === 'default') {
    return file.getClasses().find((candidate) => candidate.isDefaultExport()) ?? null
  }
  return file.getClass(origin.exportedName) ?? null
}

/**
 * Origin of a local identifier: which module it came from, and under which name
 * it was exported there.
 *
 * The distinction is not pedantry. A custom base commonly does
 * `import { BaseModel as AdonisBaseModel }` — comparing the local identifier
 * name would fail and the whole model would vanish from the count. What
 * identifies it is the pair (specifier, exported name).
 */
type ImportOrigin = { specifier: string; exportedName: string }

function originOf(local: string, file: SourceFile): ImportOrigin | null {
  for (const declaration of file.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue()

    if (declaration.getDefaultImport()?.getText() === local) {
      return { specifier, exportedName: 'default' }
    }

    for (const named of declaration.getNamedImports()) {
      const binding = named.getAliasNode()?.getText() ?? named.getName()
      if (binding === local) return { specifier, exportedName: named.getName() }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// columns
// ---------------------------------------------------------------------------
/**
 * `@column()`, `@column({ isPrimary: true })` and `@column.dateTime(...)`.
 *
 * `static $columns` is the canonical list generated from migrations, but it
 * says nothing about which field is the primary key nor where each one is
 * declared — so it serves to CROSS-CHECK, while the decorators remain the
 * primary reading.
 */
function columnsOf(cls: ClassDeclaration): Attribute[] {
  const file = cls.getSourceFile().getFilePath()
  const attributes: Attribute[] = []

  for (const property of cls.getProperties()) {
    for (const decorator of property.getDecorators()) {
      // `getName()` returns 'dateTime' for `@column.dateTime()`; the full name
      // is required, otherwise every date column silently drops from the count
      const full = decorator.getFullName()
      if (full !== 'column' && !full.startsWith('column.')) continue

      const options = decorator.getExpression().getText()
      const isIdentifier = /isPrimary\s*:\s*true/.test(options)
      /**
       * `autoCreate` / `autoUpdate`: the framework stamps it on insert or update.
       * The user neither supplies nor maintains the value, so it is not a DET —
       * counting-decisions §6. Recorded here as a fact about the column; the
       * counting side decides what to do with it.
       */
      const system = /auto(Create|Update)\s*:\s*true/.test(options)
      /**
       * `serializeAs: null`: Lucid never serialises the column, so it cannot leave
       * the boundary on an output. It is still a DET of the data function — the
       * user supplies a password — counting-decisions §6.
       */
      const hidden = /serializeAs\s*:\s*null/.test(options)

      attributes.push({
        name: property.getName(),
        type: property.getTypeNode()?.getText(),
        isIdentifier,
        ...(system ? { system } : {}),
        ...(hidden ? { hidden } : {}),
        provenance: { file, line: property.getStartLineNumber(), by: 'column-decorator' },
      })
    }
  }

  return attributes
}

/**
 * Declared relations: property -> target store.
 *
 * `@belongsTo(() => Author) declare author` yields `{ author: 'Author' }`,
 * which is what lets `.preload('author')` resolve later.
 */
function relationsOf(classes: ClassDeclaration[]): Record<string, string> {
  const relations: Record<string, string> = {}

  for (const cls of classes) {
    for (const property of cls.getProperties()) {
      for (const decorator of property.getDecorators()) {
        if (!ALL_RELATIONS.has(decorator.getName())) continue
        const target = decorator
          .getExpression()
          .getText()
          .match(/=>\s*([A-Za-z_$][\w$]*)/)
        if (target) relations[property.getName()] = target[1]
      }
    }
  }

  return relations
}

/**
 * The pivot tables of a model's `@manyToMany` relations: the `pivotTable` option, or
 * Lucid's default — the two model names, snake-cased, sorted, joined by `_`. Reading a
 * pivot through the raw query builder reads the relation: both stores.
 */
function pivotsOf(classes: ClassDeclaration[], owner: string): Record<string, string> {
  const pivots: Record<string, string> = {}
  const snake = (value: string) => value.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()
  for (const cls of classes) {
    for (const property of cls.getProperties()) {
      for (const decorator of property.getDecorators()) {
        if (decorator.getName() !== 'manyToMany') continue
        const text = decorator.getExpression().getText()
        const target = text.match(/=>\s*([A-Za-z_$][\w$]*)/)?.[1]
        if (!target) continue
        const declared = text.match(/pivotTable\s*:\s*['"]([a-z_][\w]*)['"]/)?.[1]
        const table = declared ?? [snake(owner), snake(target)].sort().join('_')
        pivots[table] = target
      }
    }
  }
  return pivots
}

/** composition relations, candidates for a logical subgroup (RET) */
function subgroupsOf(classes: ClassDeclaration[]): string[] {
  const subgroups = new Set<string>()

  for (const cls of classes) {
    for (const property of cls.getProperties()) {
      for (const decorator of property.getDecorators()) {
        if (!COMPOSITION_RELATIONS.has(decorator.getName())) continue
        const target = decorator
          .getExpression()
          .getText()
          .match(/=>\s*([A-Za-z_$][\w$]*)/)
        if (target) subgroups.add(target[1])
      }
    }
  }

  return [...subgroups].sort()
}

// ---------------------------------------------------------------------------
// table
// ---------------------------------------------------------------------------
function tableOf(cls: ClassDeclaration): string | undefined {
  const declared = cls.getStaticProperty('table')
  if (!declared || !Node.isPropertyDeclaration(declared)) return undefined
  return declared.getInitializer()?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
}

/** Lucid convention when `static table` is not declared */
function tableFromName(name: string): string {
  const snake = name.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()
  return snake.endsWith('s') ? snake : `${snake}s`
}
