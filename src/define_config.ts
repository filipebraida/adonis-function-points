import type { ComplexityTable } from './albrecht/tables.js'
import type { CallResolver } from './inventory/resolvers/types.js'
import type { Complexity, FunctionType } from './types.js'

/**
 * Configuração do pacote.
 *
 * **Toda opção aqui tem efeito, e tem um teste provando.** Configuração que o
 * código não honra é pior que configuração ausente: quem a define acha que
 * mudou algo e não mudou, e o número vai para uma fatura.
 *
 * Por isso a lista é curta. O que sobra como configuração é o que é **decisão
 * de negócio** e nenhuma heurística deveria tomar — a fronteira da aplicação, o
 * que é mantido externamente, as faixas de complexidade calibradas. O resto o
 * pacote descobre.
 *
 * Opções que já estiveram aqui e saíram, por não terem efeito:
 * `collapseInquiriesIntoOutputs` (o AFP §6.5.3 manda sempre colapsar CE em SE,
 * então não há escolha) e `calibration` (calibrar é decisão de quem assina o
 * contrato; aplicar fator em silêncio faria a contagem deixar de ser
 * reproduzível a partir do código — ver `fp:calibrate`).
 */
export type FunctionPointsConfig = {
  /**
   * Fronteira da aplicação. É decisão de negócio, não técnica — reveja com quem
   * assina o contrato, não só com o time.
   */
  boundary: {
    /**
     * Repositórios de infraestrutura, fora da contagem: tokens de sessão,
     * auditoria, filas, cache.
     *
     * Complementa o filtro automático de dados técnicos (AFP §6.5.2.1.1), que
     * já pega nome de sessão, erro, busca e template. Exclusões daqui também
     * aparecem no relatório, com o motivo.
     */
    infrastructure?: string[]
    /**
     * Repositórios mantidos por outro sistema: viram AIE em vez de ALI.
     *
     * Ex.: tabelas espelhadas de um ERP externo.
     */
    externallyMaintained?: string[]
    /**
     * Pontos de entrada sem valor funcional para o usuário, por nome de rota ou
     * por identidade (`GET /health`).
     *
     * Na prática quase nunca é necessário: rota de infraestrutura não alcança
     * repositório de dados e já cai fora pela decisão §1. Fica como rede de
     * segurança e para deixar a intenção explícita.
     */
    ignoreEntryPoints?: string[]
  }

  /**
   * Estratégia para RET, os subgrupos lógicos de um ALI/AIE.
   *
   * `constant` fixa em 1 e é honesto: o que o usuário reconhece como subgrupo
   * não é derivável do código. `composition` deriva das relações de composição;
   * erra mais, mas capta agregados reais.
   */
  retStrategy: 'constant' | 'composition'

  /**
   * Profundidade máxima no grafo de chamadas a partir do handler.
   *
   * Fundo demais e um service gordo contamina; raso demais e a escrita passa
   * batida.
   */
  maxDepth: number

  /**
   * DET extra por mensagem de confirmação ou erro.
   *
   * O manual do IFPUG conta 1, o AFP não — e foi a divergência sistemática de
   * −1 DET por transação medida na dissertação do Ligeiro. Default segue o AFP.
   */
  messageDet: number

  /** Faixas de complexidade, para calibrar contra contagem manual. */
  complexityTables?: Partial<Record<FunctionType, ComplexityTable>>

  /** Pesos por tipo e complexidade. */
  weights?: Partial<Record<FunctionType, Record<Complexity, number>>>

  /**
   * Estratégias de rastreamento próprias, somadas às embutidas e rodando
   * **antes** delas.
   *
   * É o que torna verdadeira a afirmação central da arquitetura: AdonisJS não
   * impõe padrão de organização, então um projeto com convenção própria registra
   * a sua aqui.
   */
  resolvers?: { call?: CallResolver[] }

  /**
   * Cobertura mínima do rastreamento, de 0 a 1.
   *
   * Abaixo dela a análise **falha** em vez de emitir um número que parece certo.
   * Um total com muitas chamadas não resolvidas não deveria virar fatura.
   */
  minCoverage?: number
}

export const DEFAULTS: FunctionPointsConfig = {
  boundary: {},
  retStrategy: 'constant',
  maxDepth: 3,
  messageDet: 0,
}

export function defineConfig(config: Partial<FunctionPointsConfig>): FunctionPointsConfig {
  return {
    ...DEFAULTS,
    ...config,
    boundary: { ...DEFAULTS.boundary, ...config.boundary },
  }
}
