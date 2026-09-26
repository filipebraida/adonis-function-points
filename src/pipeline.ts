import { discoverApp } from './inventory/app_context.js'
import { collectDataStores } from './inventory/sources/data_stores.js'
import { collectEntryPoints } from './inventory/sources/routes_ast.js'
import { collectEventBindings } from './inventory/sources/event_bindings.js'
import { collectJsonSchemas } from './inventory/sources/json_schemas.js'
import { createAnalyzer } from './inventory/graph/call_graph.js'
import { count } from './albrecht/counter.js'
import { relativeTo } from './inventory/paths.js'
import { describeSource } from './inventory/source.js'
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
  /**
   * Configuration file that produced these options, recorded in the count's
   * `source`. The pipeline does not read it — the front-ends do — but the
   * artefact has to say which configuration shaped the number.
   */
  configFile?: string | null
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

  /** only read when an override names one — but collected once, like everything else */
  const jsonSchemas = collectJsonSchemas(app)

  const analyzer = createAnalyzer(app, stores, {
    maxDepth: options.maxDepth,
    callResolvers: options.resolvers?.call,
    eventBindings: collectEventBindings(app),
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

  /**
   * Every path that LEAVES is relative to the application root.
   *
   * `CountSource.app` is documented as never being the absolute path, because that
   * says where the machine keeps its files and travels with every artefact sent
   * anywhere. The rule was stated on one field and applied to one field: the
   * inventory carried 2036 absolute paths across ten of them, and a count carried
   * 858 in its traces alone.
   *
   * Absolute is right INTERNALLY — it is what ts-morph resolves and what the call
   * graph keys its caches on — so the conversion happens here, at the boundary, and
   * the data-store `id` is relativised only after the ancestor filter has used it.
   */
  const source = describeSource(root, options.configFile ?? null)

  const emit = (value: string) => relativeTo(app.root, value)
  const emitProvenance = <T extends { file: string }>(p: T): T => ({ ...p, file: emit(p.file) })

  const inventory: Inventory = {
    version: 1,
    generatedAt: new Date().toISOString(),
    app: source.app,
    framework: { core: app.framework.core, lucid: app.framework.lucid, orm: app.framework.orm },
    dataStores: stores.map((store) => ({
      ...store,
      id: emit(store.id),
      provenance: emitProvenance(store.provenance),
      attributes: store.attributes.map((a) => ({ ...a, provenance: emitProvenance(a.provenance) })),
    })),
    entryPoints: entryPoints.map((entry) => ({
      ...entry,
      provenance: emitProvenance(entry.provenance),
      handler: entry.handler ? { ...entry.handler, file: emit(entry.handler.file) } : null,
    })),
    behaviors: [...behaviors.entries()].map(([entryPointId, behavior]) => ({
      entryPointId,
      writes: behavior.writes,
      touches: behavior.touches,
      writtenStores: behavior.writtenStores,
      inputFields: behavior.inputFields.map((name) => ({
        name,
        provenance: { file: emit(app.root), by: 'validator' },
      })),
      opaqueInputFields: behavior.opaqueInputFields.map((name) => ({
        name,
        provenance: { file: emit(app.root), by: 'validator' },
      })),
      requestFields: behavior.requestFields.map((name) => ({
        name,
        provenance: { file: emit(app.root), by: 'request' },
      })),
      opaqueRequest: behavior.opaqueRequest,
      outputFields: behavior.outputFields.map((name) => ({
        name,
        provenance: { file: emit(app.root), by: 'transformer' },
      })),
      opaqueOutputFields: behavior.opaqueOutputFields.map((name) => ({
        name,
        provenance: { file: emit(app.root), by: 'transformer' },
      })),
      transformedStores: behavior.transformedStores,
      delivered: behavior.delivered,
      outputReads: behavior.outputReads,
      trace: behavior.trace.map((step) => ({ ...step, file: emit(step.file) })),
      unresolved: behavior.unresolved.map((call) => ({ ...call, file: emit(call.file) })),
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

  const counted = count(
    {
      app,
      stores,
      entryPoints,
      behaviors,
      jsonSchemas,
      writtenAnywhere: analyzer.writtenAnywhere(),
      addressedAnywhere: analyzer.addressedAnywhere(),
      seededAnywhere: analyzer.seededAnywhere(),
    },
    options
  )

  return {
    inventory,
    count: { ...counted, source },
  }
}
