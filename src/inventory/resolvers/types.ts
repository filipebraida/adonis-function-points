import type { CallExpression, Node, SourceFile } from 'ts-morph'

import type { DataStore, EntryPoint, HandlerRef, Provenance } from '../../types.js'

/**
 * AdonisJS não impõe um padrão de organização. A mesma transação pode estar
 * escrita de formas muito diferentes:
 *
 *   controller gordo   await User.create(payload)
 *   action object      await new CreateUser().handle(payload)
 *   service estático   await UserService.create(payload)
 *   service injetado   await this.users.create(payload)
 *   repository         await this.repo.persist(user)
 *   job                await CreateUserJob.dispatch(payload)
 *   query builder      await db.table('users').insert(payload)
 *
 * Nenhuma lista fechada cobre isso. Por isso o rastreamento é montado a partir
 * de estratégias registráveis, e o que nenhuma delas resolve é REPORTADO como
 * não resolvido — nunca silenciosamente tratado como leitura.
 *
 * Esse é o contrato mais importante do pacote: preferimos dizer "não sei"
 * a produzir um número que parece certo.
 */

export type ResolverContext = {
  /** arquivo onde está o call site */
  file: SourceFile
  /** profundidade atual no grafo de chamadas */
  depth: number
  /** imports do arquivo: identificador local -> caminho absoluto resolvido */
  imports: Map<string, string>
  /**
   * Dependências injetadas visíveis neste corpo: nome da propriedade ->
   * arquivo da classe. Ex.: `billing` -> `.../billing_service.ts`.
   *
   * Não exige type checker: o `@inject()` do AdonisJS **obriga** a anotação
   * explícita do tipo para o container resolver a dependência, então
   * `constructor(protected billing: BillingService)` sempre traz o tipo
   * como identificador — importado como qualquer outro.
   */
  injected: Map<string, string>
  /**
   * DataStores conhecidos, por nome do símbolo (ex.: 'User').
   *
   * INVARIANTE DE ORDEM: os DataStores são coletados ANTES de qualquer
   * análise de handler. Sem isso, `UserService.create()` e `User.create()`
   * são indistinguíveis pela forma — e um resolvedor acabaria percorrendo o
   * model como se fosse código de negócio.
   */
  dataStoresBySymbol: Map<string, DataStore>
  /** resolve um specifier do AdonisJS (`#collect/models/invite`) para caminho */
  resolveSpecifier(specifier: string): string | null
  /** carrega um arquivo no projeto, se existir */
  sourceFile(absPath: string): SourceFile | null
}

/**
 * Segue um call site até o próximo corpo a analisar.
 *
 * Retorna [] quando a estratégia não reconhece a chamada — isso NÃO é erro,
 * outra estratégia pode reconhecê-la. Só quando nenhuma reconhece é que a
 * chamada entra em `unresolved`.
 */
export interface CallResolver {
  readonly name: string
  /** menor roda primeiro; estratégias específicas antes das genéricas */
  readonly order?: number
  resolve(call: CallExpression, ctx: ResolverContext): HandlerRef[]
}

/**
 * Decide se um call site toca um repositório de dados, e como.
 *
 * Separado do CallResolver de propósito: trocar o ORM (Lucid -> outro) muda
 * o detector, não o grafo de chamadas.
 */
export interface PersistenceDetector {
  readonly name: string
  readonly order?: number
  detect(call: CallExpression, ctx: ResolverContext): PersistenceAccess | null
}

export type PersistenceAccess = {
  mode: 'read' | 'write'
  /** id do DataStore, quando identificável */
  store?: string
  /** símbolo usado no código, para diagnóstico quando `store` é desconhecido */
  symbol?: string
  provenance: Provenance
}

/**
 * De onde saem os repositórios lógicos de dados (candidatos a ALI/AIE).
 * Padrão: models do Lucid + migrations. Outra fonte (Prisma, schema SQL puro)
 * entra como outro coletor.
 */
export interface DataStoreCollector {
  readonly name: string
  collect(ctx: CollectorContext): Promise<DataStore[]> | DataStore[]
}

/**
 * De onde saem os pontos de entrada (candidatos a EE/SE/CE).
 *
 * Transação não é sinônimo de rota HTTP: um comando ace que importa uma
 * planilha, ou um job agendado que sincroniza com um sistema externo, são
 * funções transacionais pelo IFPUG. Cada um é um coletor.
 */
export interface EntryPointCollector {
  readonly name: string
  collect(ctx: CollectorContext): Promise<EntryPoint[]> | EntryPoint[]
}

export type CollectorContext = {
  /** raiz da aplicação analisada */
  appRoot: string
  sourceFiles(glob: string): SourceFile[]
  sourceFile(absPath: string): SourceFile | null
  resolveSpecifier(specifier: string): string | null
  /** nó -> {file, line} para procedência */
  provenanceOf(node: Node, by: string): Provenance
}

export type ResolverRegistry = {
  callResolvers: CallResolver[]
  persistenceDetectors: PersistenceDetector[]
  dataStoreCollectors: DataStoreCollector[]
  entryPointCollectors: EntryPointCollector[]
}
