import { discoverApp } from './inventory/app_context.js'
import { collectDataStores } from './inventory/sources/data_stores.js'
import { collectEntryPoints } from './inventory/sources/routes_ast.js'
import { createAnalyzer } from './inventory/graph/call_graph.js'
import { count } from './albrecht/counter.js'
import type { CountOptions } from './albrecht/counter.js'
import type { CallResolver } from './inventory/resolvers/types.js'
import type { CountResult, Inventory } from './types.js'

/**
 * The whole pipeline, in one place.
 *
 * Ace commands stay thin on purpose: they hold no logic and only print what
 * this module returns. That is what makes it possible to test counting without
 * booting an AdonisJS application — fixtures do not boot.
 *
 * The order is not arbitrary. Data stores come before any handler analysis,
 * because `Model.create()` and `Service.create()` are indistinguishable by
 * shape; and counting comes last, because ILF vs EIF depends on HOW
 * transactions use each store (AFP §6.5.4).
 */

export type AnalysisOptions = CountOptions & {
  /** call-graph depth from the handler */
  maxDepth?: number
  /** custom tracing strategies, running before the built-in ones */
  resolvers?: { call?: CallResolver[] }
  /**
   * Minimum tracing coverage. Below it the analysis fails rather than emitting
   * a number that looks right.
   */
  minCoverage?: number
}

export type Analysis = {
  inventory: Inventory
  count: CountResult
}

export class CoverageTooLowError extends Error {
  constructor(
    readonly ratio: number,
    readonly minimum: number
  ) {
    super(
      `tracing coverage ${(ratio * 100).toFixed(1)}% is below the minimum of ` +
        `${(minimum * 100).toFixed(0)}%: the count is not reliable enough to become ` +
        `a number. Run \`fp:inventory\` to see what is unresolved.`
    )
    this.name = 'CoverageTooLowError'
  }
}

export async function analyze(root: string, options: AnalysisOptions = {}): Promise<Analysis> {
  const app = await discoverApp(root)
  const { stores, unresolved: storeProblems } = await collectDataStores(app)
  const { entryPoints, unresolved: routeProblems } = await collectEntryPoints(app)

  const analyzer = createAnalyzer(app, stores, {
    maxDepth: options.maxDepth,
    callResolvers: options.resolvers?.call,
  })

  const behaviors = new Map(
    entryPoints
      .filter((entry) => entry.handler)
      .map((entry) => [entry.id, analyzer.analyze(entry.handler!)])
  )

  const resolved = [...behaviors.values()].filter(
    (behavior) => behavior.unresolved.length === 0
  ).length

  const unresolvedCalls =
    storeProblems.length +
    routeProblems.length +
    [...behaviors.values()].reduce((total, behavior) => total + behavior.unresolved.length, 0)

  const inventory: Inventory = {
    version: 1,
    generatedAt: new Date().toISOString(),
    app: app.root,
    framework: { core: app.framework.core, lucid: app.framework.lucid, orm: app.framework.orm },
    dataStores: stores,
    entryPoints,
    behaviors: [...behaviors.entries()].map(([entryPointId, behavior]) => ({
      entryPointId,
      writes: behavior.writes,
      touches: behavior.touches,
      inputFields: behavior.inputFields.map((name) => ({
        name,
        provenance: { file: app.root, by: 'validator' },
      })),
      outputFields: [],
      trace: behavior.trace,
      unresolved: behavior.unresolved,
    })),
    coverage: {
      entryPointsTotal: entryPoints.length,
      entryPointsResolved: resolved,
      unresolvedCalls,
      ratio: entryPoints.length === 0 ? 1 : resolved / entryPoints.length,
    },
  }

  const minimum = options.minCoverage ?? 0
  if (inventory.coverage.ratio < minimum) {
    throw new CoverageTooLowError(inventory.coverage.ratio, minimum)
  }

  return { inventory, count: count({ app, stores, entryPoints, behaviors }, options) }
}
