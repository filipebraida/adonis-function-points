import type { Inventory } from '../types.js'
import type { CountResult } from '../types.js'

/**
 * Métricas estruturais e de densidade, derivadas do MESMO inventário.
 *
 * Nada aqui coleta fato novo: se o grafo já sabe quais transações alcançam quais
 * repositórios e por quais módulos passam, acoplamento e densidade são
 * aritmética sobre isso. É o que torna estas métricas quase gratuitas — e é a
 * razão da camada de inventário não conhecer APF.
 *
 * Por que importam junto com PF: se PF paga, o time otimiza PF. Mais models,
 * mais endpoints, menos reuso. Densidade e acoplamento no mesmo painel são o
 * contrapeso — sem eles a métrica vira alvo, não medida.
 */

export type ModuleMetrics = {
  module: string
  functionPoints: number
  /** transações que este módulo expõe */
  transactions: number
  /** repositórios de dados que este módulo declara */
  dataStores: number
  /** módulos de que este depende: transações daqui alcançam dados de lá */
  dependsOn: string[]
  /** módulos que dependem deste */
  dependedOnBy: string[]
  /**
   * Instabilidade de Martin: `Ce / (Ca + Ce)`.
   *
   * 0 = estável (todos dependem dele, ele de ninguém); 1 = instável. Módulo
   * estável que muda muito é onde a mudança dói.
   */
  instability: number
}

export type StructureMetrics = {
  modules: ModuleMetrics[]
  /** pares de módulos com dependência mútua — candidatos a ciclo */
  mutualDependencies: [string, string][]
  /** PF por repositório de dados: densidade funcional */
  pointsPerDataStore: number
  /** transações por repositório: quanto cada entidade é exercitada */
  transactionsPerDataStore: number
}

export function measureStructure(inventory: Inventory, count: CountResult): StructureMetrics {
  /** repositório -> módulo que o declara */
  const storeModule = new Map(inventory.dataStores.map((store) => [store.name, store.module]))

  /** ponto de entrada -> módulo */
  const entryModule = new Map(inventory.entryPoints.map((entry) => [entry.id, entry.module]))

  const modules = new Set<string>([...storeModule.values(), ...entryModule.values()])

  const dependsOn = new Map<string, Set<string>>()
  for (const module of modules) dependsOn.set(module, new Set())

  /**
   * A dependência que interessa é de USO, não de import: o módulo A depende de B
   * quando uma transação de A alcança um repositório declarado em B. Import de
   * tipo não cria acoplamento funcional.
   */
  for (const behavior of inventory.behaviors) {
    const from = entryModule.get(behavior.entryPointId)
    if (!from) continue

    for (const store of behavior.touches) {
      const to = storeModule.get(store)
      if (!to || to === from) continue
      dependsOn.get(from)?.add(to)
    }
  }

  const dependedOnBy = new Map<string, Set<string>>()
  for (const module of modules) dependedOnBy.set(module, new Set())
  for (const [from, targets] of dependsOn) {
    for (const to of targets) dependedOnBy.get(to)?.add(from)
  }

  const transactionsPerModule = new Map<string, number>()
  for (const module of entryModule.values()) {
    transactionsPerModule.set(module, (transactionsPerModule.get(module) ?? 0) + 1)
  }

  const storesPerModule = new Map<string, number>()
  for (const module of storeModule.values()) {
    storesPerModule.set(module, (storesPerModule.get(module) ?? 0) + 1)
  }

  const moduleMetrics: ModuleMetrics[] = [...modules]
    .map((module) => {
      const ce = dependsOn.get(module)!.size
      const ca = dependedOnBy.get(module)!.size

      return {
        module,
        functionPoints: count.totals.byModule[module] ?? 0,
        transactions: transactionsPerModule.get(module) ?? 0,
        dataStores: storesPerModule.get(module) ?? 0,
        dependsOn: [...dependsOn.get(module)!].sort(),
        dependedOnBy: [...dependedOnBy.get(module)!].sort(),
        instability: ca + ce === 0 ? 0 : round(ce / (ca + ce)),
      }
    })
    .sort((a, b) => b.functionPoints - a.functionPoints)

  const mutual: [string, string][] = []
  for (const [from, targets] of dependsOn) {
    for (const to of targets) {
      if (from < to && dependsOn.get(to)?.has(from)) mutual.push([from, to])
    }
  }

  const stores = inventory.dataStores.length || 1

  return {
    modules: moduleMetrics,
    mutualDependencies: mutual.sort(),
    pointsPerDataStore: round(count.totals.unadjusted / stores),
    transactionsPerDataStore: round(inventory.entryPoints.length / stores),
  }
}

/**
 * Conformidade com a própria convenção da aplicação.
 *
 * Não mede tamanho nem qualidade: mede se o time segue o que combinou. Sai de
 * graça do inventário, e numa fábrica é o que vira auditoria de padrão.
 */
export type Conformance = {
  /** transações de escrita cujos campos de entrada vêm de um validator */
  writesWithValidator: { ok: number; total: number; ratio: number }
  /** pontos de entrada cujo handler foi resolvido */
  entryPointsWithHandler: { ok: number; total: number; ratio: number }
  /** repositórios de dados que alguma transação alcança */
  dataStoresReached: { ok: number; total: number; ratio: number }
}

export function measureConformance(inventory: Inventory): Conformance {
  const behaviors = inventory.behaviors

  const writes = behaviors.filter((behavior) => behavior.writes)
  const withValidator = writes.filter((behavior) => behavior.inputFields.length > 0)

  const withHandler = inventory.entryPoints.filter((entry) => entry.handler !== null)

  const reached = new Set(behaviors.flatMap((behavior) => behavior.touches))

  return {
    writesWithValidator: ratio(withValidator.length, writes.length),
    entryPointsWithHandler: ratio(withHandler.length, inventory.entryPoints.length),
    dataStoresReached: ratio(reached.size, inventory.dataStores.length),
  }
}

const ratio = (ok: number, total: number) => ({
  ok,
  total,
  ratio: total === 0 ? 1 : round(ok / total),
})

const round = (value: number) => Math.round(value * 1000) / 1000
