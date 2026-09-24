import type { Inventory } from '../types.js'
import type { CountResult } from '../types.js'

/**
 * Structural and density metrics, derived from the SAME inventory.
 *
 * Nothing here collects a new fact: once the graph knows which transactions
 * reach which stores and which modules they pass through, coupling and density
 * are arithmetic over that. It is also why the inventory layer knows nothing of
 * FPA.
 *
 * Why they belong beside function points: if function points pay, the team
 * optimises function points — more models, more endpoints, less reuse. Density
 * and coupling on the same dashboard are the counterweight; without them the
 * measure becomes a target.
 */

export type ModuleMetrics = {
  module: string
  functionPoints: number
  /** transactions this module exposes */
  transactions: number
  /** data stores this module declares */
  dataStores: number
  /** modules this one depends on: its transactions reach their data */
  dependsOn: string[]
  /** modules that depend on this one */
  dependedOnBy: string[]
  /**
   * Martin's instability: `Ce / (Ca + Ce)`.
   *
   * 0 means stable (everyone depends on it, it depends on nobody); 1 means
   * unstable. A stable module that changes often is where change hurts.
   */
  instability: number
}

export type StructureMetrics = {
  modules: ModuleMetrics[]
  /** module pairs with mutual dependency — cycle candidates */
  mutualDependencies: [string, string][]
  /** function points per data store: functional density */
  pointsPerDataStore: number
  /** transactions per store: how much each entity is exercised */
  transactionsPerDataStore: number
}

export function measureStructure(inventory: Inventory, count: CountResult): StructureMetrics {
  /** store -> module that declares it */
  const storeModule = new Map(inventory.dataStores.map((store) => [store.name, store.module]))

  /** entry point -> module */
  const entryModule = new Map(inventory.entryPoints.map((entry) => [entry.id, entry.module]))

  const modules = new Set<string>([...storeModule.values(), ...entryModule.values()])

  const dependsOn = new Map<string, Set<string>>()
  for (const module of modules) dependsOn.set(module, new Set())

  /**
   * The dependency that matters is USE, not import: module A depends on B when
   * a transaction of A reaches a store declared in B. A type-only import
   * creates no functional coupling.
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
 * Conformance to the application's own conventions.
 *
 * Measures neither size nor quality: it measures whether the team follows what
 * it agreed on. It comes free from the inventory, and in a software factory it
 * is what turns into a standards audit.
 */
export type Conformance = {
  /** write transactions whose input fields come from a validator */
  writesWithValidator: { ok: number; total: number; ratio: number }
  /** entry points whose handler was resolved */
  entryPointsWithHandler: { ok: number; total: number; ratio: number }
  /** data stores reached by at least one transaction */
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
