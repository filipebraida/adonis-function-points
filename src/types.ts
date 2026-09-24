/**
 * Modelo de domínio do pacote.
 *
 * Duas camadas, deliberadamente independentes:
 *
 *   Inventory  — fatos crus extraídos da aplicação. NÃO conhece APF.
 *   Albrecht   — regras IFPUG/AFP aplicadas sobre o inventário.
 *
 * `src/inventory/**` nunca deve importar de `src/albrecht/**`.
 */

// ---------------------------------------------------------------------------
// Procedência — toda medida precisa saber de onde veio.
// Sem isto, uma contagem é um número mágico e ninguém consegue contestá-la.
// ---------------------------------------------------------------------------
export type Provenance = {
  file: string
  line?: number
  /** nome do coletor/resolvedor/detector que produziu o fato */
  by: string
}

// ---------------------------------------------------------------------------
// INVENTÁRIO — fatos crus
// ---------------------------------------------------------------------------

/** Um repositório lógico de dados persistido pela aplicação. */
export type DataStore = {
  id: string
  /** nome como o usuário o reconheceria (model, tabela) */
  name: string
  module: string
  /** tabela física, quando conhecida */
  table?: string
  /** atributos persistidos, excluindo identificadores técnicos */
  attributes: Attribute[]
  /** subgrupos lógicos candidatos (relações de composição) */
  subgroups: string[]
  /**
   * Relações declaradas: nome da propriedade -> nome do repositório alvo.
   *
   * É o que permite resolver `.preload('author')` para o repositório `Author`.
   * Sem isso, uma tabela lida só por relação não é alcançada por transação
   * nenhuma e cai fora da contagem pela AFP §6.5.4 — quando na verdade é um
   * AIE legítimo.
   */
  relations: Record<string, string>
  /** mantido por esta aplicação, ou por um sistema externo? */
  maintainedExternally: boolean
  provenance: Provenance
}

export type Attribute = {
  name: string
  type?: string
  isIdentifier: boolean
  provenance: Provenance
}

/**
 * Um ponto de entrada da aplicação: rota HTTP, comando ace, job, listener.
 * Transações não são só HTTP — um comando agendado que importa um arquivo
 * é tão transacional quanto um POST.
 */
export type EntryPoint = {
  id: string
  kind: 'http' | 'command' | 'job' | 'listener'
  module: string
  /** verbo HTTP, nome do comando, nome do evento… */
  trigger: string
  /** padrão da rota, assinatura do comando… */
  signature: string
  /** nome da rota quando existir — é a identidade estável entre versões */
  name?: string
  handler: HandlerRef | null
  provenance: Provenance
}

export type HandlerRef = {
  file: string
  /** método da classe; ausente em handler de ação única */
  member?: string
  /**
   * Linha do corpo, para handler que não tem nome: closure inline declarada na
   * própria rota (`router.get('/', ({ response }) => …)`).
   *
   * Aparece em 3 das 5 aplicações de produção levantadas, e o corpo dela é
   * código de negócio como qualquer outro — precisa ser percorrido pelo grafo.
   */
  line?: number
}

/** O que o código alcançável a partir de um EntryPoint efetivamente faz. */
export type HandlerBehavior = {
  entryPointId: string
  /** escreve em algum DataStore dentro da fronteira? */
  writes: boolean
  /** DataStores alcançados (ids) */
  touches: string[]
  /** campos de entrada declarados (validators) */
  inputFields: Field[]
  /** campos de saída declarados (transformers, DTOs) */
  outputFields: Field[]
  /** caminho percorrido no grafo de chamadas — é o que `fp:explain` mostra */
  trace: TraceStep[]
  /** chamadas que nenhum resolvedor soube seguir */
  unresolved: UnresolvedCall[]
}

export type Field = {
  name: string
  optional?: boolean
  provenance: Provenance
}

export type TraceStep = {
  file: string
  member?: string
  depth: number
  /** resolvedor que produziu este passo */
  by: string
  writes: boolean
}

/**
 * Chamada que o grafo não conseguiu seguir.
 *
 * Isto NÃO é ruído de log — é a métrica de cobertura do inventário.
 * Muitas não resolvidas significa contagem não confiável, e o relatório
 * precisa dizer isso em vez de fingir precisão.
 */
export type UnresolvedCall = {
  file: string
  line: number
  expression: string
  reason: string
}

export type Inventory = {
  /** versão do formato, para diffs entre releases */
  version: 1
  generatedAt: string
  app: string
  dataStores: DataStore[]
  entryPoints: EntryPoint[]
  behaviors: HandlerBehavior[]
  coverage: {
    entryPointsTotal: number
    entryPointsResolved: number
    unresolvedCalls: number
  }
}

// ---------------------------------------------------------------------------
// ALBRECHT — contagem
// ---------------------------------------------------------------------------

export type FunctionType = 'ILF' | 'EIF' | 'EI' | 'EO' | 'EQ'
export type Complexity = 'low' | 'average' | 'high'

export type CountedFunction = {
  id: string
  name: string
  module: string
  type: FunctionType
  /** DET — data element types */
  det: number
  /** RET para funções de dados, FTR para transacionais */
  refs: number
  complexity: Complexity
  points: number
  /** por que foi classificada assim — alimenta `fp:explain` */
  rationale: Rationale
}

export type Rationale = {
  /** regra aplicada, ex.: 'afp:transaction-writes -> EI' */
  rule: string
  /** de onde vieram os DETs, um a um */
  detSources: string[]
  /** de onde vieram os FTR/RET */
  refSources: string[]
  /** ajustes manuais aplicados via config, com a justificativa exigida */
  overrides?: { reason: string; by: string }[]
  trace?: TraceStep[]
}

export type CountResult = {
  /** identifica o conjunto de regras — contagens só são comparáveis se bater */
  ruleset: string
  rulesetVersion: string
  functions: CountedFunction[]
  totals: {
    unadjusted: number
    byType: Record<FunctionType, { count: number; points: number }>
    byModule: Record<string, number>
  }
  /** sinaliza quando a contagem não merece confiança */
  confidence: {
    unresolvedCalls: number
    entryPointsWithoutHandler: number
    warnings: string[]
  }
}

/** Tipo de manutenção, para contagem de projetos de melhoria. */
export type ChangeType = 'added' | 'changed' | 'removed' | 'unchanged'

export type DiffEntry = {
  function: CountedFunction
  change: ChangeType
  previous?: CountedFunction
}

export type DiffResult = {
  from: string
  to: string
  entries: DiffEntry[]
  totals: Record<ChangeType, { count: number; points: number }>
}
