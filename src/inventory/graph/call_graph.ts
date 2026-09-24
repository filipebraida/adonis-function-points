import { createHash } from 'node:crypto'
import { Node, Project, SyntaxKind } from 'ts-morph'
import type { CallExpression, ClassDeclaration, SourceFile } from 'ts-morph'

import type { AppContext } from '../app_context.js'
import type { CollectedDataStore } from '../sources/data_stores.js'
import { detectAccess, rootSymbolOf } from '../detectors/lucid.js'
import type { RelationMap, StoreSymbols } from '../detectors/lucid.js'
import { resolveCall } from '../resolvers/index.js'
import type { ResolverContext } from '../resolvers/types.js'
import type { HandlerRef, TraceStep, UnresolvedCall } from '../../types.js'

/**
 * O grafo transação → funções de dados. É a espinha da contagem.
 *
 * Três das quatro decisões de borda se resolvem aqui: rota estática não conta
 * porque não alcança dado; rota de pacote idem; hook de model conta porque está
 * no caminho. E o AFP manda agregar TODOS os caminhos alcançáveis:
 *
 *   "When the static code analyzer finds multiple optional paths in the context
 *    of a transaction, it shall consider these multiple optional paths to be
 *    part of the same transaction."  — AFP §6.5.3
 *
 * Percorre em nível de MÉTODO, nunca de arquivo: um service de domínio de uma
 * app real tem 38 escritas, e perguntar pelo arquivo marcaria como escritor
 * todo mundo que o importa.
 */

export type ScopeEntry = {
  file: string
  member?: string
  /** hash do AST normalizado — counting-decisions §5 */
  bodyHash: string
}

export type Behavior = {
  writes: boolean
  /** repositórios de dados alcançados */
  touches: string[]
  /**
   * Campos de entrada declarados: `request.validateUsing(x)` resolvido até os
   * campos do schema VineJS — counting-decisions §7.
   */
  inputFields: string[]
  trace: TraceStep[]
  /** corpos alcançados, para o `fp:diff` */
  scope: ScopeEntry[]
  unresolved: UnresolvedCall[]
}

/**
 * Campos declarados pelos validators usados neste corpo.
 *
 * `request.validateUsing(createBookValidator)` -> resolve o validator ->
 * conta as folhas do `vine.object`, pela tabela de counting-decisions §7:
 *
 *   escalar                          1
 *   objeto aninhado                  folhas contadas individualmente
 *   array de escalar                 1  (grupo repetitivo)
 *   array de objeto                  folhas, uma vez só
 *   spread não resolvido             0, e vira pendência — nunca chuta
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

/** declaração do validator: no próprio arquivo ou importada da aplicação */
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

/** folhas de um schema VineJS, pela tabela de §7 */
function leavesOf(node: Node): string[] {
  const object = node.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression)
  if (!object) return []

  const leaves: string[] = []

  const walk = (literal: typeof object, prefix: string) => {
    for (const property of literal.getProperties()) {
      // spread não resolvido conta 0: melhor faltar do que chutar
      if (!Node.isPropertyAssignment(property)) continue

      const name = property.getName().replace(/['"]/g, '')
      const text = property.getText()
      const nested = property.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression)

      // `vine.object({...})` aninhado: folhas contam individualmente
      // `vine.array(vine.object({...}))`: grupo repetitivo, folhas uma vez só
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

/** nome do arquivo, para identificar a pendência sem despejar o caminho todo */
const pathOf = (file: string) => file.split('/').pop()?.replace(/\.ts$/, '') ?? file

/** fatos de um corpo, independentes de quem o chamou */
type BodyFacts = {
  accesses: { store: string; write: boolean }[]
  /** validators usados neste corpo */
  validators: string[]
  followUps: { ref: HandlerRef; by: string }[]
  unresolved: UnresolvedCall[]
  bodyHash: string
}

export type GraphOptions = {
  /** quanto seguir a partir do handler; o default vem da configuração */
  maxDepth?: number
}

const DEFAULT_MAX_DEPTH = 3

/**
 * Analisador com estado compartilhado entre handlers.
 *
 * O `Project` do ts-morph e o cache de símbolos são caros de montar e idênticos
 * para todos os handlers da mesma aplicação. Criar um por handler multiplicava
 * o custo pelo número de rotas — numa app de 160 rotas, passava de dois
 * minutos. Com o projeto compartilhado, cai para segundos.
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
   * Todos os arquivos entram de uma vez.
   *
   * Adicionar arquivo no meio da análise invalida o programa do TypeScript, e a
   * próxima consulta ao checker o reconstrói — com 161 rotas isso custava ~344
   * ms por rota, uniformemente. Carregar tudo antes troca N reconstruções por
   * uma.
   */
  for (const root of app.scanRoots) {
    project.addSourceFilesAtPaths(`${root}/**/*.ts`)
  }

  const storesByName = new Map(stores.map((store) => [store.name, store]))
  const relationsByStore: RelationMap = new Map(
    stores.map((store) => [store.name, store.relations])
  )
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH

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

  /** imports por arquivo, calculados uma vez só */
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
   * Fatos de um corpo: o que ele acessa e para onde ele chama.
   *
   * São INDEPENDENTES de quem chamou — só a decisão de seguir depende da
   * profundidade. Sem este cache, um service compartilhado é reanalisado uma
   * vez por rota que chega nele, e o custo cresce com rotas × profundidade.
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
        // tabela alcançada por relação é lida, nunca escrita por este acesso
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

      const resolved = resolveCall(call, context)
      if (resolved) {
        for (const next of resolved.refs) followUps.push({ ref: next, by: resolved.by })
        continue
      }

      if (isWorthReporting(call, symbols, imports)) {
        unresolved.push({
          file: ref.file,
          line: call.getStartLineNumber(),
          expression: call.getExpression().getText().replace(/\s+/g, ''),
          reason: 'chamada que nenhuma estratégia soube seguir',
        })
      }
    }

    return { accesses, followUps, unresolved, validators, bodyHash: hashOf(body) }
  }

  return {
    analyze: (handler: HandlerRef) => run(handler),
    /** quantos arquivos o projeto carregou — usado para provar que não cresce */
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
         * O resolvedor acertou o arquivo, mas o corpo não está lá — método
         * herdado de classe de pacote, por exemplo (`Transformer.transform()`
         * vem de `BaseTransformer`).
         *
         * Descartar em silêncio é o pior defeito possível: a transação perde um
         * caminho e ninguém sabe.
         */
        unresolved.push({
          file: ref.file,
          line: ref.line ?? 0,
          expression: `${pathOf(ref.file)}.${ref.member ?? 'handle'}`,
          reason:
            'corpo não encontrado no arquivo resolvido: provavelmente herdado de classe de pacote',
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

/** Conveniência para um handler só; para vários, use `createAnalyzer`. */
export function analyzeHandler(
  app: AppContext,
  stores: CollectedDataStore[],
  handler: HandlerRef,
  options: GraphOptions = {}
): Behavior {
  return createAnalyzer(app, stores, options).analyze(handler)
}

// ---------------------------------------------------------------------------
// corpo a analisar
// ---------------------------------------------------------------------------
/**
 * Resolve `HandlerRef` para o corpo correspondente.
 *
 * Três formas convivem: método nomeado, handler de ação única (`handle`), e
 * closure inline declarada na própria rota — esta última localizada por linha,
 * porque não tem nome.
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
// símbolos que resolvem para um repositório de dados
// ---------------------------------------------------------------------------
/**
 * Monta o mapa de símbolos válido DENTRO deste corpo.
 *
 * Inclui os models importados no arquivo e as variáveis locais derivadas deles:
 * `const invite = await Invite.findOrFail(...)` faz `invite.save()` contar como
 * escrita em `Invite`.
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

  // variáveis locais derivadas de um repositório já conhecido
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer()
    const name = declaration.getNameNode()
    if (!initializer || !Node.isIdentifier(name)) continue

    const root = rootSymbolOf(initializer)
    const store = root ? symbols.get(root) : undefined
    if (store) symbols.set(name.getText(), store)
  }

  // parâmetros que carregam um repositório
  if (Node.isMethodDeclaration(body) || Node.isFunctionDeclaration(body)) {
    for (const parameter of body.getParameters()) {
      const typeNode = parameter.getTypeNode()
      const nameNode = parameter.getNameNode()

      // forma direta: `expire(invite: Invite)`
      const typeName = typeNode?.getText()
      if (typeName && stores.has(typeName) && Node.isIdentifier(nameNode)) {
        symbols.set(nameNode.getText(), typeName)
        continue
      }

      /**
       * Tipo nomeado: `handle(input: ExpireInviteInput)` com
       * `interface ExpireInviteInput { invite: Invite }`.
       *
       * Registra o CAMINHO `input.invite`, porque é assim que a escrita
       * aparece: `input.invite.save()`. Padrão dominante nas apps reais.
       */
      if (typeNode && Node.isIdentifier(nameNode)) {
        for (const [property, propertyType] of membersOfType(typeNode, file, app)) {
          if (stores.has(propertyType)) {
            symbols.set(`${nameNode.getText()}.${property}`, propertyType)
          }
        }
      }

      /**
       * Forma desestruturada: `handle({ invite }: { invite: Invite })`.
       *
       * É o padrão dominante em action object — o objeto de ação recebe um
       * payload nomeado. Sem isto, `invite.save()` dentro da action não conta
       * como escrita, e a transação inteira vira SE em vez de EE.
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
 * Dependências injetadas visíveis no corpo: nome da propriedade -> arquivo.
 *
 * Duas formas, ambas com o tipo anotado explicitamente — o `@inject()` não
 * funciona sem isso:
 *
 *   constructor(protected billing: BillingService) {}
 *   private declare billing: BillingService
 *
 * Como o tipo é um identificador importado, resolve pelo mesmo caminho de
 * qualquer import. Não precisa de type checker.
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

/** identificador de tipo -> arquivo da aplicação onde ele é declarado */
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
 * Membros de um tipo declarado: `interface X { a: A }` -> { a: 'A' }.
 *
 * Aceita tipo literal inline e tipo nomeado declarado no próprio arquivo ou
 * importado da aplicação. Fora disso devolve vazio — sem chutar.
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
// ruído vs pendência
// ---------------------------------------------------------------------------
/**
 * Nem toda chamada não seguida é pendência — mas o filtro tem que errar para o
 * lado de reportar.
 *
 * `response.redirect()` e `inertia.render()` não levam a dado nenhum e só
 * afogariam o relatório. Mas chamada sobre símbolo importado da PRÓPRIA
 * aplicação pode esconder acesso a dados, e silenciá-la é o pior defeito
 * possível aqui: a transação vira SE sem ninguém saber.
 *
 * A primeira versão deste filtro só reportava `this.` — e escondia o tamanho
 * real da lacuna numa app de produção.
 */
function isWorthReporting(
  call: CallExpression,
  symbols: StoreSymbols,
  imports: Map<string, string>
): boolean {
  const expression = call.getExpression()

  // função de módulo importada da aplicação: `expireInvite(...)`
  if (Node.isIdentifier(expression)) return imports.has(expression.getText())

  if (!Node.isPropertyAccessExpression(expression)) return false

  const root = rootSymbolOf(expression.getExpression())
  if (!root) return false

  // já contabilizado como acesso a dados
  if (symbols.has(root)) return false

  // `this.algo()` pode ser dependência injetada — lacuna conhecida da 4a
  if (root === 'this') return true

  // símbolo da própria aplicação que nenhuma estratégia seguiu
  return imports.has(root)
}

// ---------------------------------------------------------------------------
// hash do escopo
// ---------------------------------------------------------------------------
/**
 * Hash do corpo NORMALIZADO: sem comentário e sem whitespace.
 *
 * counting-decisions §5 mede modificação por checksum do escopo de
 * implementação. Se o hash fosse dos bytes, rodar o prettier viraria fatura.
 */
function hashOf(body: Node): string {
  const normalized = body
    .getText()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, '')

  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}
