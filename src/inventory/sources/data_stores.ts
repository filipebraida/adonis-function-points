import { Node, Project, SyntaxKind } from 'ts-morph'
import type { ClassDeclaration, SourceFile } from 'ts-morph'

import type { AppContext } from '../app_context.js'
import type { Attribute, DataStore, UnresolvedCall } from '../../types.js'

/**
 * Coleta os repositórios lógicos de dados — candidatos a ALI/AIE.
 *
 * A falha que este módulo existe para tornar impossível: numa aplicação
 * levantada há 35 arquivos de model e ZERO `extends BaseModel` do Lucid, porque
 * os models estendem classes de schema geradas das migrations. Ler só o arquivo
 * do model contaria zero para a aplicação inteira, **em silêncio**.
 *
 * Por isso a unidade de trabalho é a CADEIA DE HERANÇA, não o arquivo:
 *
 *   class User extends BaseModel                        (direto)
 *   class User extends UserSchema                       (schema gerado)
 *   class User extends compose(UserSchema, Auditable)   (mixin)
 *
 * Onde a cadeia sai da aplicação — um mixin vindo de pacote — a coleta para e
 * **reporta**. Um mixin de soft-delete acrescenta `deletedAt`; fingir que não
 * existe seria contar errado sem avisar.
 */

export type ColumnSource = 'ast' | 'generated-schema'

export type CollectedDataStore = DataStore & {
  /** de onde as colunas vieram; contagens de fontes diferentes não são equivalentes */
  columnSource: ColumnSource
}

export type DataStoreCollection = {
  stores: CollectedDataStore[]
  /** cadeias que saíram da aplicação, exigido pelo AFP §6.5.3 */
  unresolved: UnresolvedCall[]
}

const LUCID_ORM = '@adonisjs/lucid/orm'
const BASE_MODEL = 'BaseModel'

/** decorators que marcam relação de composição — candidatos a subgrupo (RET) */
const COMPOSITION_RELATIONS = new Set(['hasMany', 'hasOne'])

export async function collectDataStores(app: AppContext): Promise<DataStoreCollection> {
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

  /**
   * Classes que aparecem como ANCESTRAL de algum model.
   *
   * Uma base não tem tabela; contá-la inventa um repositório de dados que não
   * existe. E não é caso de laboratório: 17 dos 34 models de uma app real
   * estendem um `BaseModel` próprio.
   */
  const ancestors = new Set<string>()

  for (const file of project.getSourceFiles()) {
    // o arquivo gerado é BASE dos models, não um model em si
    if (app.generated.dataSchema && file.getFilePath() === app.generated.dataSchema) continue

    for (const cls of file.getClasses()) {
      const described = describeStore(cls, app, project, unresolved)
      if (!described) continue

      candidates.push(described.store)
      for (const ancestor of described.ancestors) ancestors.add(ancestor)
    }
  }

  const stores = candidates.filter((store) => !ancestors.has(store.id))
  return { stores: stores.sort(byName), unresolved }
}

/** identidade estável de uma classe, para separar base de repositório */
const classKey = (cls: ClassDeclaration) => `${cls.getSourceFile().getFilePath()}#${cls.getName()}`

const byName = (a: DataStore, b: DataStore) => a.name.localeCompare(b.name)

// ---------------------------------------------------------------------------
// uma classe -> um repositório de dados, se a cadeia levar ao Lucid
// ---------------------------------------------------------------------------
function describeStore(
  cls: ClassDeclaration,
  app: AppContext,
  project: Project,
  unresolved: UnresolvedCall[]
): { store: CollectedDataStore; ancestors: string[] } | null {
  const name = cls.getName()
  if (!name) return null

  const chain = walkChain(cls, app, project)
  if (!chain.reachesLucid) return null

  unresolved.push(...chain.unresolved)
  const file = cls.getSourceFile().getFilePath()

  // a própria classe é chain.classes[0]; o resto são ancestrais
  const store: CollectedDataStore = {
    id: classKey(cls),
    name,
    module: app.moduleOf(file),
    table: tableOf(cls) ?? tableFromName(name),
    attributes: chain.attributes,
    subgroups: subgroupsOf(chain.classes),
    // decidido pela configuração de fronteira, não por heurística
    maintainedExternally: false,
    columnSource: chain.columnSource,
    provenance: { file, line: cls.getStartLineNumber(), by: 'data-stores' },
  }

  return { store, ancestors: chain.classes.slice(1).map(classKey) }
}

type Chain = {
  /** a cadeia chega ao BaseModel do Lucid? só então é repositório de dados */
  reachesLucid: boolean
  classes: ClassDeclaration[]
  attributes: Attribute[]
  columnSource: ColumnSource
  unresolved: UnresolvedCall[]
}

/**
 * Sobe a cadeia de herança acumulando colunas.
 *
 * `extends compose(A, B)` tem mais de um pai: os dois entram. Quem não for
 * resolvível dentro da aplicação vira pendência — e não é detalhe, é a
 * diferença entre "não tem coluna" e "não sei se tem".
 */
function walkChain(start: ClassDeclaration, app: AppContext, project: Project): Chain {
  const classes: ClassDeclaration[] = []
  const attributes = new Map<string, Attribute>()
  const seen = new Set<string>()

  /**
   * Pendências ficam locais à cadeia e só sobem se ela for mesmo de model.
   * Sem isso, toda classe da aplicação que estende algo de pacote — controller,
   * exception, middleware — viraria ruído no relatório de cobertura.
   */
  const unresolved: UnresolvedCall[] = []
  let reachesLucid = false
  let columnSource: ColumnSource = 'ast'

  const visit = (cls: ClassDeclaration) => {
    const key = `${cls.getSourceFile().getFilePath()}#${cls.getName()}`
    if (seen.has(key)) return
    seen.add(key)
    classes.push(cls)

    if (app.generated.dataSchema === cls.getSourceFile().getFilePath()) {
      columnSource = 'generated-schema'
    }

    for (const attribute of columnsOf(cls)) {
      if (!attributes.has(attribute.name)) attributes.set(attribute.name, attribute)
    }

    for (const parent of parentsOf(cls)) {
      const origin = originOf(parent.getText(), cls.getSourceFile())

      // chegou ao Lucid?
      if (origin?.specifier === LUCID_ORM && origin.exportedName === BASE_MODEL) {
        reachesLucid = true
        continue
      }

      const resolved = resolveClass(parent.getText(), cls.getSourceFile(), app, project)
      if (resolved) {
        visit(resolved)
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
  }
}

/**
 * Por que a base não foi resolvida.
 *
 * A razão certa importa tanto quanto o fato: dizer "fora da aplicação" para
 * código que está dentro dela manda o usuário procurar no lugar errado, e o
 * relatório de cobertura existe justamente para ser acionável.
 */
function reasonFor(parent: Node, file: SourceFile, app: AppContext): string {
  if (Node.isCallExpression(parent)) {
    return 'fábrica de mixin: a coluna só existe na classe que a função retorna, e avaliar o retorno está fora do alcance da análise estática atual'
  }

  const origin = originOf(parent.getText(), file)
  if (origin && !app.resolveSpecifier(origin.specifier)) {
    return `classe base fora da aplicação (${origin.specifier}): o pacote não sabe quais colunas ela acrescenta`
  }

  return 'classe base não encontrada na aplicação'
}

/**
 * Pais de uma classe. `extends compose(A, B)` devolve A e B; `extends X`
 * devolve X.
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

  // export default pode ter nome diferente do binding local
  if (origin.exportedName === 'default') {
    return file.getClasses().find((candidate) => candidate.isDefaultExport()) ?? null
  }
  return file.getClass(origin.exportedName) ?? null
}

/**
 * Origem de um identificador local: de qual módulo veio e com que nome foi
 * exportado lá.
 *
 * A distinção não é preciosismo. Numa app real o base customizado faz
 * `import { BaseModel as AdonisBaseModel }` — comparar o nome do identificador
 * local falharia, e o model inteiro sumiria da contagem. O que identifica é o
 * par (specifier, nome exportado).
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
// colunas
// ---------------------------------------------------------------------------
/**
 * `@column()`, `@column({ isPrimary: true })` e `@column.dateTime(...)`.
 *
 * `static $columns` é a lista canônica gerada das migrations, mas não diz qual
 * é a chave primária nem a linha de cada campo — então serve para CONFERIR, e
 * os decorators continuam sendo a leitura principal.
 */
function columnsOf(cls: ClassDeclaration): Attribute[] {
  const file = cls.getSourceFile().getFilePath()
  const attributes: Attribute[] = []

  for (const property of cls.getProperties()) {
    for (const decorator of property.getDecorators()) {
      // `getName()` devolve 'dateTime' para `@column.dateTime()`; é preciso o
      // nome completo, senão toda coluna de data some da contagem em silêncio
      const full = decorator.getFullName()
      if (full !== 'column' && !full.startsWith('column.')) continue

      const isIdentifier = /isPrimary\s*:\s*true/.test(decorator.getExpression().getText())
      attributes.push({
        name: property.getName(),
        type: property.getTypeNode()?.getText(),
        isIdentifier,
        provenance: { file, line: property.getStartLineNumber(), by: 'column-decorator' },
      })
    }
  }

  return attributes
}

/** relações de composição, candidatas a subgrupo lógico (RET) */
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
// tabela
// ---------------------------------------------------------------------------
function tableOf(cls: ClassDeclaration): string | undefined {
  const declared = cls.getStaticProperty('table')
  if (!declared || !Node.isPropertyDeclaration(declared)) return undefined
  return declared.getInitializer()?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
}

/** convenção do Lucid quando `static table` não é declarado */
function tableFromName(name: string): string {
  const snake = name.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()
  return snake.endsWith('s') ? snake : `${snake}s`
}
