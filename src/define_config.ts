import type { ComplexityTable } from './albrecht/tables.js'
import type {
  CallResolver,
  DataStoreCollector,
  EntryPointCollector,
  PersistenceDetector,
} from './inventory/resolvers/types.js'
import type { Complexity, FunctionType } from './types.js'

export type FunctionPointsConfig = {
  /**
   * Fronteira da aplicação. Tudo fora não é contado.
   * A fronteira é uma decisão de negócio, não técnica — por isso é config,
   * não heurística.
   */
  boundary: {
    /** módulos/pastas dentro da fronteira; vazio = todos */
    include?: string[]
    exclude?: string[]
    /**
     * DataStores mantidos por outro sistema. Viram AIE em vez de ALI.
     * Ex.: tabelas espelhadas de um ERP externo.
     */
    externallyMaintained?: string[]
    /**
     * Repositórios de infraestrutura, fora da contagem: tokens de sessão,
     * tabelas de auditoria, filas, cache.
     */
    infrastructure?: string[]
    /** rotas técnicas, sem valor funcional para o usuário */
    ignoreEntryPoints?: string[]
  }

  /**
   * Estratégia para RET (subgrupos lógicos de um ALI/AIE).
   *
   * `constant` fixa em 1 — foi o que o Ligeiro fez, e é honesto: o que o
   * usuário reconhece como subgrupo não é derivável do código.
   * `composition` deriva de relações de composição; erra mais, mas capta
   * agregados reais.
   */
  retStrategy: 'constant' | 'composition'

  /**
   * Profundidade máxima no grafo de chamadas ao rastrear uma transação.
   * Fundo demais e um service gordo contamina todos os seus leitores;
   * raso demais e a escrita passa batida.
   */
  maxCallDepth: number

  /**
   * O AFP manda colapsar CE em SE, porque distinguir consulta de saída exige
   * saber se há cálculo ou dado derivado — o que análise estática não vê.
   * `true` segue o AFP; `false` tenta separar e vai errar mais.
   */
  collapseInquiriesIntoOutputs: boolean

  complexityTables?: Partial<Record<FunctionType, ComplexityTable>>
  weights?: Partial<Record<FunctionType, Record<Complexity, number>>>

  /**
   * Fatores de calibração por tipo, obtidos comparando com contagem manual.
   * Ver `fp:calibrate`.
   */
  calibration?: Partial<Record<FunctionType, number>>

  /**
   * Ajustes manuais. A justificativa é OBRIGATÓRIA: um override sem motivo
   * registrado é indefensável numa auditoria, e este pacote existe para
   * sustentar números contestáveis.
   */
  overrides?: Array<{
    match: string
    set: Partial<Pick<import('./types.js').CountedFunction, 'type' | 'det' | 'refs'>>
    reason: string
  }>

  /** Estratégias adicionais, somadas às embutidas. */
  resolvers?: {
    call?: CallResolver[]
    persistence?: PersistenceDetector[]
    dataStores?: DataStoreCollector[]
    entryPoints?: EntryPointCollector[]
  }

  /**
   * Falha a contagem quando a cobertura do rastreamento cai abaixo do limite.
   * Um número com 40% das chamadas não resolvidas não deveria virar fatura.
   */
  minCoverage?: number
}

export const DEFAULTS: FunctionPointsConfig = {
  boundary: {},
  retStrategy: 'constant',
  maxCallDepth: 3,
  collapseInquiriesIntoOutputs: true,
  minCoverage: 0.85,
}

export function defineConfig(config: Partial<FunctionPointsConfig>): FunctionPointsConfig {
  return {
    ...DEFAULTS,
    ...config,
    boundary: { ...DEFAULTS.boundary, ...config.boundary },
  }
}
