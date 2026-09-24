import type { AppContext } from '../inventory/app_context.js'
import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { CollectedEntryPoint } from '../inventory/sources/routes_ast.js'
import type { Behavior } from '../inventory/graph/call_graph.js'
import type { Complexity, CountResult, CountedFunction, FunctionType } from '../types.js'
import { DEFAULT_TABLES, DEFAULT_WEIGHTS } from './tables.js'
import type { ComplexityTable } from './tables.js'
import { countDataFunctions } from './data_functions.js'
import type { StoreUsage } from './data_functions.js'
import { countTransactionalFunctions } from './transactional_functions.js'
import { isTechnical } from './technical_filter.js'

/**
 * Monta a contagem a partir do inventário.
 *
 * A ordem importa e não é arbitrária: as funções de dados dependem de COMO as
 * transações usam cada repositório (AFP §6.5.4), e as transacionais dependem de
 * quais repositórios entraram na contagem. Então: uso primeiro, filtro técnico,
 * dados, transações.
 */

export const RULESET = 'afp'

/**
 * Versão do conjunto de regras.
 *
 * Sai em todo relatório e o `fp:diff` recusa comparar contagens de versões
 * diferentes — senão somaria laranjas com maçãs.
 */
export const RULESET_VERSION = '1.0.0'

export type CountInput = {
  app: AppContext
  stores: CollectedDataStore[]
  entryPoints: CollectedEntryPoint[]
  /** comportamento por `EntryPoint.id`; ausente = sem handler */
  behaviors: Map<string, Behavior>
}

export type CountOptions = {
  retStrategy?: 'constant' | 'composition'
  boundary?: {
    infrastructure?: string[]
    externallyMaintained?: string[]
    ignoreEntryPoints?: string[]
  }
  messageDet?: number
  complexityTables?: Partial<Record<FunctionType, ComplexityTable>>
  weights?: Partial<Record<FunctionType, Record<Complexity, number>>>
}

export function count(input: CountInput, options: CountOptions = {}): CountResult {
  const warnings: string[] = []

  // 1. como cada repositório é usado pelas transações
  const usage = usageOf(input)

  const tables = { ...DEFAULT_TABLES, ...options.complexityTables }
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights }
  const infrastructure = new Set(options.boundary?.infrastructure ?? [])

  // 2. filtro de dados técnicos — AFP §6.5.2.1.1, mais a fronteira configurada
  const countable = input.stores.filter((store) => {
    if (infrastructure.has(store.name) || infrastructure.has(store.table ?? '')) {
      warnings.push(`fora da contagem por configuração de fronteira: ${store.name}`)
      return false
    }
    const technical = isTechnical(store)
    if (technical) warnings.push(`técnico, fora da contagem: ${store.name} (${technical})`)
    return !technical
  })

  // 3. funções de dados
  const dataFunctions = countDataFunctions(countable, usage, {
    retStrategy: options.retStrategy ?? 'constant',
    externallyMaintained: new Set(options.boundary?.externallyMaintained ?? []),
    tables,
    weights,
  })

  // 4. funções transacionais, sobre os repositórios que de fato contam
  const countedStores = new Map(
    dataFunctions.map((fn) => [fn.name, countable.find((store) => store.name === fn.name)!])
  )

  const ignored = new Set(options.boundary?.ignoreEntryPoints ?? [])
  const entryPoints = input.entryPoints.filter(
    (entry) => !ignored.has(entry.identity) && !ignored.has(entry.name ?? '')
  )

  const transactionalFunctions = countTransactionalFunctions(entryPoints, input.behaviors, {
    countedStores,
    messageDet: options.messageDet ?? 0,
    tables,
    weights,
  })

  const functions = [...dataFunctions, ...transactionalFunctions]

  return {
    ruleset: RULESET,
    rulesetVersion: RULESET_VERSION,
    functions,
    totals: totalsOf(functions),
    confidence: confidenceOf(input, warnings),
  }
}

/**
 * Uso de cada repositório pelas transações.
 *
 * `written` decide ALI vs AIE; `used` decide se entra na contagem.
 */
function usageOf(input: CountInput): Map<string, StoreUsage> {
  const usage = new Map<string, StoreUsage>()

  for (const entry of input.entryPoints) {
    const behavior = input.behaviors.get(entry.id)
    if (!behavior) continue

    for (const store of behavior.touches) {
      const current = usage.get(store) ?? { written: false, used: false }
      usage.set(store, {
        used: true,
        // basta UMA transação escrever para o repositório ser mantido
        written: current.written || behavior.writes,
      })
    }
  }

  return usage
}

const EMPTY_BY_TYPE: Record<FunctionType, { count: number; points: number }> = {
  ILF: { count: 0, points: 0 },
  EIF: { count: 0, points: 0 },
  EI: { count: 0, points: 0 },
  EO: { count: 0, points: 0 },
  EQ: { count: 0, points: 0 },
}

function totalsOf(functions: CountedFunction[]): CountResult['totals'] {
  const byType = structuredClone(EMPTY_BY_TYPE)
  const byModule: Record<string, number> = {}
  let unadjusted = 0

  for (const fn of functions) {
    byType[fn.type].count++
    byType[fn.type].points += fn.points
    byModule[fn.module] = (byModule[fn.module] ?? 0) + fn.points
    unadjusted += fn.points
  }

  return { unadjusted, byType, byModule }
}

/**
 * Confiança da contagem.
 *
 * O AFP exige que o que faltou apareça no relatório (§6.5.3). Um total com
 * muitas chamadas não resolvidas não deveria virar fatura, e quem lê tem que
 * poder ver isso sem ir procurar.
 */
function confidenceOf(input: CountInput, warnings: string[]): CountResult['confidence'] {
  let unresolvedCalls = 0
  let withoutHandler = 0

  for (const entry of input.entryPoints) {
    const behavior = input.behaviors.get(entry.id)
    if (!behavior) {
      withoutHandler++
      continue
    }
    unresolvedCalls += behavior.unresolved.length
  }

  return { unresolvedCalls, entryPointsWithoutHandler: withoutHandler, warnings }
}
