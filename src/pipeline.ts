import { discoverApp } from './inventory/app_context.js'
import { collectDataStores } from './inventory/sources/data_stores.js'
import { collectEntryPoints } from './inventory/sources/routes_ast.js'
import { createAnalyzer } from './inventory/graph/call_graph.js'
import { count } from './albrecht/counter.js'
import type { CountOptions } from './albrecht/counter.js'
import type { CallResolver } from './inventory/resolvers/types.js'
import type { CountResult, Inventory } from './types.js'

/**
 * O pipeline completo, num lugar só.
 *
 * Os comandos ace ficam finos de propósito: eles não têm lógica, só imprimem o
 * que este módulo devolve. Isso é o que permite testar a contagem sem bootar
 * uma aplicação AdonisJS — as fixtures não bootam.
 *
 * A ordem não é arbitrária. Os repositórios de dados vêm antes de qualquer
 * análise de handler, porque `Model.create()` e `Service.create()` são
 * indistinguíveis pela forma; e a contagem vem depois de tudo, porque ALI vs AIE
 * depende de COMO as transações usam cada repositório (AFP §6.5.4).
 */

export type AnalysisOptions = CountOptions & {
  /** profundidade do grafo de chamadas a partir do handler */
  maxDepth?: number
  /** estratégias de rastreamento próprias, rodando antes das embutidas */
  resolvers?: { call?: CallResolver[] }
  /**
   * Cobertura mínima do rastreamento. Abaixo dela a análise falha em vez de
   * emitir um número que parece certo.
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
      `cobertura de rastreamento ${(ratio * 100).toFixed(1)}% abaixo do mínimo ` +
        `de ${(minimum * 100).toFixed(0)}%: a contagem não é confiável o suficiente ` +
        `para virar número. Rode \`fp:inventory\` e veja as pendências.`
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
