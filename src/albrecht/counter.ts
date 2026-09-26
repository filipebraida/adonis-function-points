import type { AppContext } from '../inventory/app_context.js'
import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { CollectedEntryPoint } from '../inventory/sources/routes_ast.js'
import type { Behavior } from '../inventory/graph/call_graph.js'
import type { DiscoveredSchema } from '../inventory/sources/json_schemas.js'
import type { CollectedJob } from '../inventory/sources/jobs.js'
import { relativeTo, toPosix } from '../inventory/paths.js'
import { applyOpaque, opaqueWarnings } from './opaque.js'
import type { OpaqueDeclaration } from './opaque.js'
import type { Complexity, CountResult, CountedFunction, FunctionType } from '../types.js'
import { DEFAULT_TABLES, DEFAULT_WEIGHTS, complexityOf, pointsOf } from './tables.js'
import type { FunctionOverride } from '../define_config.js'
import type { ComplexityTable } from './tables.js'
import { countDataFunctions, groupStores } from './data_functions.js'
import type { GroupingStrategy, StoreUsage } from './data_functions.js'
import { countTransactionalFunctions } from './transactional_functions.js'
import { isTechnical } from './technical_filter.js'
import type { TechnicalPattern } from './technical_filter.js'

/**
 * Assembles the count from the inventory.
 *
 * The order is not arbitrary: data functions depend on HOW transactions use
 * each store (AFP §6.5.4), and transactional functions depend on which stores
 * ended up counted. Hence: usage first, then the technical filter, then data,
 * then transactions.
 */

export const RULESET = 'afp'

/**
 * Version of the rule set.
 *
 * It appears in every report, and `fp:diff` refuses to compare counts produced
 * by different versions — otherwise the difference would measure the rule
 * change rather than the work.
 *
 * It must be bumped by ANY change that moves the number for unchanged code, and
 * that is easy to forget. Four such changes landed in 1.1.0 — maintenance read
 * across the whole project rather than from routes alone, a job followed into
 * `process`, an event followed into its listeners, and `request.input(…)` counted
 * as a DET — three more in 1.2.0: an open input object counting 1 instead of 0,
 * `detFromSchema` no longer subtracting a placeholder that was not there, and a
 * write through `related(…)` maintaining the related table — and six in 1.5.0:
 * output DETs read from transformers, selects and aggregates instead of every
 * column; system timestamps and `serializeAs: null` columns leaving the DETs;
 * master-detail folded into one data function; identity by table; token tables
 * technical; and opaque declarations reaching every function carrying the origin.
 * Three in 1.6.0: an output's DETs are what the transaction DELIVERS (the render
 * props, the response payload, what a command prints) read back to their origin;
 * a function of the same file and a `.map(fn)` by reference are followed, so
 * FTRs move; and ace commands are transactions, with flags as input.
 *
 * Without the bump, a baseline saved by the previous version compares cleanly
 * against this one and bills the tool's own improvement as work done. The guard
 * exists for exactly that, and only this constant arms it.
 */
export const RULESET_VERSION = '1.6.0'

export type CountInput = {
  app: AppContext
  stores: CollectedDataStore[]
  entryPoints: CollectedEntryPoint[]
  /** behaviour keyed by `EntryPoint.id`; absent means no handler */
  behaviors: Map<string, Behavior>
  /** JSON Schema literals found in the code, for `detFromSchema` — §8 */
  jsonSchemas?: Map<string, DiscoveredSchema>
  /** the queue jobs and who dispatches each — a job no transaction reaches is reported (plan 0.7 §D) */
  jobs?: CollectedJob[]
  /**
   * Stores written anywhere in the application's code, reachable from an entry
   * point or not — AFP §6.5.4 asks who MAINTAINS the store, and a job or a
   * seeder is this application just as much as a route is.
   */
  writtenAnywhere?: Set<string>
  /**
   * Stores the application addresses DIRECTLY somewhere in its code — as opposed
   * to reaching only through a parent's relation. Decides which composition
   * children fold into their parent as a RET (counting-decisions §10).
   */
  addressedAnywhere?: Set<string>
  /**
   * Stores written by a SEEDER — scaffolding, so not maintenance — kept apart
   * because an EIF only a seed populates is one of two things the code cannot
   * tell: code data the team maintains (not counted, CPM) or a mirror of data
   * another system maintains in production (a legitimate EIF). Reported.
   */
  seededAnywhere?: Set<string>
}

export type CountOptions = {
  dataFunctions?: { grouping?: GroupingStrategy }
  /** what a person declared about a DET the analysis cannot read, by origin — §8 */
  opaque?: Record<string, OpaqueDeclaration>
  /** a declared DET or RET for one function — the last resort, see §8 */
  overrides?: Record<string, FunctionOverride>
  boundary?: {
    infrastructure?: string[]
    externallyMaintained?: string[]
    /** restores what the AFP naming filter caught by accident */
    business?: string[]
    /** replaces the filter's naming conventions — §6.5.2.1.3 treats them as user input */
    technicalPatterns?: TechnicalPattern[]
    ignoreEntryPoints?: string[]
  }
  messageDet?: number
  complexityTables?: Partial<Record<FunctionType, ComplexityTable>>
  weights?: Partial<Record<FunctionType, Record<Complexity, number>>>
}

export function count(input: CountInput, options: CountOptions = {}): CountResult {
  const warnings: string[] = []

  // 1. how each store is used by the transactions
  const usage = usageOf(input)

  const tables = { ...DEFAULT_TABLES, ...options.complexityTables }
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights }
  const infrastructure = new Set(options.boundary?.infrastructure ?? [])

  // 2. technical data filter — AFP §6.5.2.1.1, plus the configured boundary
  const business = new Set(options.boundary?.business ?? [])

  const countable = input.stores.filter((store) => {
    if (infrastructure.has(store.name) || infrastructure.has(store.table ?? '')) {
      warnings.push(`excluded by boundary configuration: ${store.name}`)
      return false
    }

    const technical = isTechnical(store, options.boundary?.technicalPatterns)
    if (!technical) return true

    /**
     * The naming filter is a heuristic over names, so it catches business data
     * whose name happens to match — a chat session the user manages, a document
     * template they maintain. Only a person knows which, so a declaration wins
     * over the pattern, and the report says it was overruled rather than
     * quietly counting one more store.
     */
    if (business.has(store.name) || business.has(store.table ?? '')) {
      /**
       * Whether any transaction WRITES it, said out loud.
       *
       * `business` is meant for data the user maintains, and it accepted without
       * comment a table nothing in the application writes. That is how a team put two
       * read-only lookup tables in it believing they had a CRUD — the routes were
       * `.only(['index', 'show'])`. The declaration is still honoured, because only a
       * person knows, but the fact that contradicts it is now in the report.
       */
      const maintained =
        usage.get(store.name)?.written === true || (input.writtenAnywhere?.has(store.name) ?? false)

      warnings.push(
        `kept by boundary configuration: ${store.name} — the AFP naming filter had excluded it ` +
          `(${technical})` +
          (maintained
            ? ''
            : `. NOTE: no transaction of this application writes it, so it counts as an EIF — ` +
              `check that the screens for it are more than index and show`)
      )
      return true
    }

    warnings.push(`technical, excluded: ${store.name} (${technical})`)
    return false
  })

  /**
   * A configuration the code does not honour is worse than none: whoever set it
   * believes something changed. `retStrategy` left the type in 0.6.0 — but a
   * configuration file is loaded without types, so an old one still arrives here
   * and has to be told.
   */
  if ((options as Record<string, unknown>).retStrategy !== undefined) {
    warnings.push(
      `\`retStrategy\` is no longer read: RET comes from how the application uses each table ` +
        `(counting-decisions §10), configurable as \`dataFunctions.grouping: 'usage' | 'none'\`. ` +
        `Remove the key.`
    )
  }

  /**
   * 3. how the stores fold into data functions — §10 — then the data functions.
   *
   * Grouping by usage needs the project-wide pass. Without it an empty set would
   * read as "nobody addresses this table" and fold every composition child into
   * its parent — the absence of a fact is not the fact. The pipeline always
   * provides it; a direct caller that does not is told, and gets no grouping.
   */
  const strategy = options.dataFunctions?.grouping ?? 'usage'
  if (strategy === 'usage' && input.addressedAnywhere === undefined) {
    warnings.push(
      `grouping by usage needs the project-wide pass (\`addressedAnywhere\`) and none was ` +
        `provided: every table is its own data function in this count.`
    )
  }

  const grouping = groupStores(countable, {
    grouping: input.addressedAnywhere === undefined ? 'none' : strategy,
    addressedAnywhere: input.addressedAnywhere ?? new Set(),
  })
  warnings.push(...grouping.warnings)

  const dataFunctions = countDataFunctions(countable, usage, {
    grouping,
    writtenAnywhere: input.writtenAnywhere ?? new Set(),
    externallyMaintained: new Set(options.boundary?.externallyMaintained ?? []),
    tables,
    weights,
  })

  /**
   * 4. transactional functions, over the stores that actually count — a child
   * folded into a counted root counts too: a transaction reaching it reaches the
   * group, and its columns are the group's output.
   */
  const countedRoots = new Set(dataFunctions.map((fn) => fn.name))
  const countedStores = new Map(
    countable
      .filter((store) => countedRoots.has(grouping.rootOf.get(store.name) ?? store.name))
      .map((store) => [store.name, store])
  )

  const ignored = new Set(options.boundary?.ignoreEntryPoints ?? [])
  const entryPoints = input.entryPoints.filter(
    (entry) => !ignored.has(entry.identity) && !ignored.has(entry.name ?? '')
  )

  const transactionalFunctions = countTransactionalFunctions(entryPoints, input.behaviors, {
    countedStores,
    grouping,
    root: input.app.root,
    messageDet: options.messageDet ?? 0,
    tables,
    weights,
  })

  /**
   * What the analysis could not read, answered by ORIGIN — counting-decisions §8.
   *
   * A declaration is about a column or a validator field, and it applies to every
   * function that carries the DET: the data function and each transaction that
   * takes or shows it. Keyed by function it was declared twice and still missed
   * the third place, so the same column was worth two numbers in one count.
   */
  const opaque = applyOpaque([...dataFunctions, ...transactionalFunctions], {
    declarations: options.opaque ?? {},
    stores: countable,
    schemas: input.jsonSchemas ?? new Map(),
    tables,
    weights,
  })
  warnings.push(...opaque.warnings)

  const functions = applyOverrides(
    opaque.functions,
    options.overrides ?? {},
    tables,
    weights,
    warnings
  )

  warnings.push(
    ...opaqueWarnings({
      functions,
      stores: countable,
      entryPoints: input.entryPoints,
      behaviors: input.behaviors,
      answered: opaque.answered,
    })
  )
  warnings.push(...unreadableInputWarnings(input))
  warnings.push(...unreadableOutputWarnings(input))
  warnings.push(...unreadableDeliveryWarnings(input))
  warnings.push(...commandWarnings(entryPoints, transactionalFunctions))
  warnings.push(...undispatchedJobWarnings(input))
  warnings.push(...unreadablePageWarnings(input))
  warnings.push(...lookAlikeWarnings(functions))
  warnings.push(...seededOnlyWarnings(functions, grouping.members, input.seededAnywhere))

  return {
    ruleset: RULESET,
    rulesetVersion: RULESET_VERSION,
    functions,
    totals: totalsOf(functions),
    confidence: confidenceOf(input, warnings),
  }
}

/**
 * Transactions that deliver something the analysis cannot read.
 *
 * A generated document (`response.send(gerarCsv(rows))`), a value built by a
 * call nobody followed. Each counts 1 DET — a floor — and the transaction's
 * output is understated by whatever the value carries. Named with the
 * expression, because the fix is usually in the code: return a literal, or a
 * transformer, and the fields become readable.
 */
function unreadableDeliveryWarnings(input: CountInput): string[] {
  const blind = input.entryPoints
    .map((entry) => ({ entry, behavior: input.behaviors.get(entry.id) }))
    // an EI has no output DETs: what it delivers back does not enter its count
    .filter(
      ({ behavior }) => behavior && !behavior.writes && behavior.delivered.opaqueFields.length > 0
    )

  if (blind.length === 0) return []

  return [
    `${blind.length} transaction(s) deliver a value the analysis cannot read — a generated document, ` +
      `a call nobody followed — counted as 1 DET each, a FLOOR. This UNDERSTATES the output:`,
    ...blind
      .slice(0, 10)
      .map(
        ({ entry, behavior }) =>
          `  ${entry.trigger} ${entry.signature}: ${behavior!.delivered.opaqueFields.join(', ')}`
      ),
    ...(blind.length > 10 ? [`  … and ${blind.length - 10} more`] : []),
  ]
}

/**
 * Pages the reader could not open for a store handed to them raw — plan 0.8 §D.
 *
 * The store leaves whole, as it always did; this says which page, and why: a
 * second level of components, a spread, a package's component, two files answering
 * to one name. Overestimating in the open — the fix is usually in the page.
 */
function unreadablePageWarnings(input: CountInput): string[] {
  const lines: string[] = []
  for (const entry of input.entryPoints) {
    const behavior = input.behaviors.get(entry.id)
    if (!behavior || behavior.writes) continue
    for (const [store, reason] of Object.entries(behavior.unreadablePages ?? {}))
      lines.push(`  ${entry.trigger} ${entry.signature}: ${store} leaves whole — ${reason}`)
  }
  if (lines.length === 0) return []
  return [
    `${lines.length} store(s) handed raw to a page the analysis could not read: every column counted. What the page shows would be less:`,
    ...lines.slice(0, 12),
    ...(lines.length > 12 ? [`  … and ${lines.length - 12} more`] : []),
  ]
}

/**
 * Jobs no transaction reaches — plan 0.7 §D.
 *
 * A job dispatched by a handler is part of that handler's transaction (§9). One
 * that nothing reachable dispatches is either a scheduled process — an elementary
 * process nobody is counting — or dead code, and the code cannot say which. It is
 * reported, never counted: inventing an elementary process is the error this
 * package exists to avoid.
 */
function undispatchedJobWarnings(input: CountInput): string[] {
  if (!input.jobs?.length) return []
  const reached = new Set<string>()
  for (const behavior of input.behaviors.values())
    for (const step of behavior.trace) reached.add(toPosix(step.file))

  const orphans = input.jobs.filter((job) => !reached.has(job.file))
  if (orphans.length === 0) return []

  const where = (file: string) => relativeTo(input.app.root, file)
  return [
    `${orphans.length} job(s) reached by no transaction — a scheduled process nobody counts, or dead code. ` +
      `Reported, not counted: a scheduler is an entry point of its own once one is read (counting-decisions §9):`,
    ...orphans.map(({ name, file, dispatchedFrom, scheduledFrom }) => {
      const at = `  ${name} (${where(file)}): `
      if (scheduledFrom.length > 0)
        return `${at}scheduled from ${scheduledFrom.map(where).join(', ')}, outside every transaction`
      if (dispatchedFrom.length > 0)
        return `${at}dispatched from ${dispatchedFrom.map(where).join(', ')}, which no transaction reaches`
      return `${at}dispatched by nothing in the application — dead code, or a scheduler this analysis does not read`
    }),
  ]
}

/**
 * Ace commands counted as transactions — plan 0.7 §C.
 *
 * A batch process an operator starts is an elementary process, and it is counted.
 * Half the commands on the validated applications are development tools — a data
 * generator, a scaffolder — which the CPM does not count and the code cannot tell
 * from an importer: both write the same table. So each one is listed with the FP
 * at stake, the collector's hint beside it, and the way out is a declaration.
 */
function commandWarnings(
  entryPoints: CollectedEntryPoint[],
  functions: CountedFunction[]
): string[] {
  const counted = entryPoints
    .filter((entry) => entry.kind === 'command')
    .map((entry) => ({ entry, fn: functions.find((f) => f.id === `tx:${entry.identity}`) }))
    .filter(({ fn }) => fn !== undefined)

  if (counted.length === 0) return []

  return [
    `${counted.length} ace command(s) counted as elementary processes — a batch process an operator ` +
      `starts is a transaction. A development tool (a data generator, a scaffolder) is not the ` +
      `user's: exclude it with \`boundary.ignoreEntryPoints: ['<commandName>']\`:`,
    ...counted.map(
      ({ entry, fn }) =>
        `  ${entry.identity}: ${fn!.type} ${fn!.points} FP` +
        (entry.hints?.length ? ` — ${entry.hints.join('; ')}` : '')
    ),
  ]
}

/**
 * Transactions that look like the same elementary process.
 *
 * The CPM counts identical processing logic once. `GET /perfil` and
 * `GET /perfil/editar` on a real application walk the same queries and the same
 * transformers, touch the same stores and emit the same DETs, and were 7 FP each.
 * Whether the second is a screen the user needs or a second URL for the same one
 * is not derivable from code, so both stay counted and the pair is named with
 * the FP at stake — a request to decide, answered with `boundary.ignoreEntryPoints`.
 *
 * The key is deliberately narrow: same type, same stores, same DET sources AND
 * the same bodies below the entry point. Two fat controllers that merely read the
 * same table are not flagged — with nothing followed, nothing says the logic is
 * the same.
 */
function lookAlikeWarnings(functions: CountedFunction[]): string[] {
  const groups = new Map<string, CountedFunction[]>()

  for (const fn of functions) {
    if (!fn.id.startsWith('tx:')) continue
    const below = (fn.rationale.trace ?? [])
      .filter((step) => step.depth > 0)
      .map((step) => `${step.file}#${step.member ?? '*'}`)
      .sort()
    if (below.length === 0) continue

    const key = [
      fn.type,
      [...fn.rationale.refSources].sort().join(','),
      [...fn.rationale.detSources].sort().join(','),
      below.join(','),
    ].join('|')
    groups.set(key, [...(groups.get(key) ?? []), fn])
  }

  const alike = [...groups.values()].filter((group) => group.length > 1)
  if (alike.length === 0) return []

  return [
    `${alike.length} group(s) of transactions share the same stores, the same DETs and the same ` +
      `bodies below the controller — the CPM counts identical processing logic once. Whether the ` +
      `second is a screen of its own is not derivable from the code: decide, and record it with ` +
      `\`boundary.ignoreEntryPoints\`:`,
    ...alike.map((group) => {
      const names = group.map((fn) => fn.name).sort()
      const atStake = group.slice(1).reduce((total, fn) => total + fn.points, 0)
      return `  ${names.join(' ≡ ')}   (${atStake} FP at stake)`
    }),
  ]
}

/**
 * EIFs that only a seeder writes.
 *
 * After 0.5.0 a seeder's inserts are not maintenance, so a table only the seed
 * populates is "used but not maintained" — an EIF. That is right for a table
 * that mirrors data another system maintains in production, and wrong for a
 * `roles` table: reference data the team maintains is code data under the CPM,
 * and is not counted at all. The code cannot tell the two apart, and should not
 * try; it names them and says what each answer costs.
 */
function seededOnlyWarnings(
  functions: CountedFunction[],
  members: Map<string, string[]>,
  seeded: Set<string> | undefined
): string[] {
  if (!seeded || seeded.size === 0) return []

  const named = functions.filter(
    (fn) =>
      fn.type === 'EIF' &&
      fn.rationale.rule.includes('used but not maintained') &&
      (members.get(fn.name) ?? [fn.name]).some((member) => seeded.has(member))
  )
  if (named.length === 0) return []

  return [
    `${named.length} EIF(s) are written by a seeder and by nothing else in the application. ` +
      `Reference data the team maintains is code data (CPM) and is not counted — exclude it with ` +
      `\`boundary.infrastructure\`; data another system maintains in production is a legitimate ` +
      `EIF — keep it. The code cannot tell which:`,
    ...named.map((fn) => `  ${fn.name} (${fn.points} FP)`),
  ]
}

/**
 * Transactions that read the request in a way that enumerates nothing.
 *
 * `request.all()`, `request.body()`, `request.except([…])` — whatever arrives is
 * read, and no analysis can say how many fields that is. The transaction is
 * counted from its route parameters alone, which puts it at the floor of its
 * complexity band: an undercount, and a silent one until now.
 *
 * Two earlier versions of this warning were wrong and are worth recording,
 * because both looked like rigour. The first flagged every write with no
 * validator and named `users.destroy`, `DELETE /questions/:id` and
 * `notifications.markRead` — transactions that legitimately carry nothing beyond
 * the route parameter, exactly as counting-decisions §7 describes. The second
 * narrowed to POST, PUT and PATCH, and still named `POST /orders/:id/submit` and
 * `POST /orders/:id/clear`: in an AdonisJS application POST is how a state
 * transition is expressed, so the verb does not separate a submission from a
 * trigger.
 *
 * What separates them is whether the handler reads the request at all. A trigger
 * does not. So the enumerable reads are now COUNTED — `request.input('title')` is
 * a DET — and only what cannot be enumerated is reported. A warning that names
 * routes with nothing wrong with them is the noise that teaches people to stop
 * reading the confidence block.
 */
function unreadableInputWarnings(input: CountInput): string[] {
  const blind = input.entryPoints
    .map((entry) => ({ entry, behavior: input.behaviors.get(entry.id) }))
    .filter(({ behavior }) => behavior?.opaqueRequest && behavior.inputFields.length === 0)

  if (blind.length === 0) return []

  return [
    `${blind.length} transaction(s) read the request without enumerating fields ` +
      `(\`all()\`, \`body()\`, \`except()\`), so their input DETs could not be counted and ` +
      `each sits at the floor of its band. This UNDERSTATES the total — the fix is a ` +
      `validator, not a configuration:`,
    ...blind.slice(0, 10).map(({ entry }) => `  ${entry.trigger} ${entry.signature}`),
    ...(blind.length > 10 ? [`  … and ${blind.length - 10} more`] : []),
  ]
}

/**
 * Transformers that emit something the analysis cannot read.
 *
 * `...this.resource.serialize()`, `...this.extras`: whatever the model has, or
 * whatever was handed in. Each counts 1 DET — a floor, the same as an open input
 * object — and the transaction's output is understated by however many fields
 * the spread carries. Reported with the expression, because the fix is in the
 * transformer: name the fields, or `pick` them.
 */
function unreadableOutputWarnings(input: CountInput): string[] {
  const blind = input.entryPoints
    .map((entry) => ({ entry, behavior: input.behaviors.get(entry.id) }))
    .filter(({ behavior }) => (behavior?.opaqueOutputFields.length ?? 0) > 0)

  if (blind.length === 0) return []

  return [
    `${blind.length} transaction(s) pass through a transformer that spreads something the ` +
      `analysis cannot read, counted as 1 DET each — a FLOOR. This UNDERSTATES the output; ` +
      `the fix is in the transformer (\`this.pick(...)\` or named keys), not a configuration:`,
    ...blind
      .slice(0, 10)
      .map(
        ({ entry, behavior }) =>
          `  ${entry.trigger} ${entry.signature}: ${behavior!.opaqueOutputFields.join(', ')}`
      ),
    ...(blind.length > 10 ? [`  … and ${blind.length - 10} more`] : []),
  ]
}

/**
 * Replaces what the analysis found with a NUMBER a person declared — DET or RET
 * of one function.
 *
 * Only for facts static analysis cannot reach, and only when naming the origin
 * (`opaque`) is not possible: a declared number is reproducible because it comes
 * from a versioned file, and auditable because it travels with its justification
 * into the rationale, which `fp:explain` prints — but it freezes the moment the
 * form grows. An override naming no function is a warning, never silence.
 */
function applyOverrides(
  functions: CountedFunction[],
  overrides: Record<string, FunctionOverride>,
  tables: Record<FunctionType, ComplexityTable>,
  weights: Record<FunctionType, Record<Complexity, number>>,
  warnings: string[]
): CountedFunction[] {
  const keys = Object.keys(overrides)
  if (keys.length === 0) return functions

  /**
   * A configuration the code does not honour is worse than none. The two keys
   * that used to live here moved to `opaque`, by origin, in 0.6.0 and left the
   * type — but a configuration file is loaded without types, so an old one still
   * arrives here believing something happened.
   */
  for (const [name, override] of Object.entries(overrides)) {
    const legacy = override as Record<string, unknown>
    const moved = [
      ...(legacy.detFromSchema ? ['detFromSchema'] : []),
      ...(legacy.opaqueReviewed ? ['opaqueReviewed'] : []),
    ]
    if (moved.length === 0) continue
    warnings.push(
      `override "${name}" uses \`${moved.join('\` and \`')}\`, which moved to ` +
        `\`opaque.<Store.column | validator.field>\` in 0.6.0 and is no longer read here: ` +
        `it had no effect. Declare the origin, and it applies to every function carrying it.`
    )
  }

  const used = new Set<string>()

  const applied = functions.map((fn) => {
    const override = overrides[fn.name]
    if (!override) return fn

    used.add(fn.name)

    const fields: ('det' | 'refs')[] = []
    if (override.det !== undefined) fields.push('det')
    if (override.refs !== undefined) fields.push('refs')
    if (fields.length === 0) return fn

    const det = override.det ?? fn.det
    const refs = override.refs ?? fn.refs
    const complexity = complexityOf(fn.type, refs, det, tables)

    return {
      ...fn,
      det,
      refs,
      complexity,
      points: pointsOf(fn.type, complexity, weights),
      rationale: {
        ...fn.rationale,
        overrides: [
          ...(fn.rationale.overrides ?? []),
          { by: `config:overrides.${fn.name}`, reason: override.reason, fields },
        ],
      },
    }
  })

  for (const key of keys) {
    if (!used.has(key)) {
      warnings.push(`override "${key}" matched no counted function: the declaration had no effect`)
    }
  }

  return applied
}

/**
 * How each store is used by the transactions.
 *
 * `written` decides ILF vs EIF; `used` decides whether it is counted at all.
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
        /**
         * Per STORE, not per transaction.
         *
         * `behavior.writes` decides EI against EO and says nothing about which of
         * the tables was written. Read as "this store is maintained", a reference
         * table merely READ by a route that writes something else became an ILF —
         * and on a production application that left exactly one EIF in the whole
         * count, which should have been the signal.
         */
        written: current.written || behavior.writtenStores.includes(store),
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
 * Confidence of the count.
 *
 * AFP §6.5.3 requires whatever could not be traced to appear in the report. A
 * total resting on many unresolved calls should not become an invoice, and the
 * reader must see that without having to go looking.
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
