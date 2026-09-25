import type { AppContext } from '../inventory/app_context.js'
import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { CollectedEntryPoint } from '../inventory/sources/routes_ast.js'
import type { Behavior } from '../inventory/graph/call_graph.js'
import type { DiscoveredSchema } from '../inventory/sources/json_schemas.js'
import type { Complexity, CountResult, CountedFunction, FunctionType } from '../types.js'
import { DEFAULT_TABLES, DEFAULT_WEIGHTS, complexityOf, pointsOf } from './tables.js'
import type { FunctionOverride } from '../define_config.js'
import type { ComplexityTable } from './tables.js'
import { countDataFunctions } from './data_functions.js'
import type { StoreUsage } from './data_functions.js'
import { countTransactionalFunctions } from './transactional_functions.js'
import { isTechnical } from './technical_filter.js'

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
 * as a DET — and three more in 1.2.0: an open input object counting 1 instead of 0,
 * `detFromSchema` no longer subtracting a placeholder that was not there, and a
 * write through `related(…)` maintaining the related table.
 *
 * Without the bump, a baseline saved by the previous version compares cleanly
 * against this one and bills the tool's own improvement as work done. The guard
 * exists for exactly that, and only this constant arms it.
 */
export const RULESET_VERSION = '1.4.0'

export type CountInput = {
  app: AppContext
  stores: CollectedDataStore[]
  entryPoints: CollectedEntryPoint[]
  /** behaviour keyed by `EntryPoint.id`; absent means no handler */
  behaviors: Map<string, Behavior>
  /** JSON Schema literals found in the code, for `detFromSchema` — §8 */
  jsonSchemas?: Map<string, DiscoveredSchema>
  /**
   * Stores written anywhere in the application's code, reachable from an entry
   * point or not — AFP §6.5.4 asks who MAINTAINS the store, and a job or a
   * seeder is this application just as much as a route is.
   */
  writtenAnywhere?: Set<string>
}

export type CountOptions = {
  retStrategy?: 'constant' | 'composition'
  /** declared DET/RET for what static analysis cannot read — see §8 */
  overrides?: Record<string, FunctionOverride>
  boundary?: {
    infrastructure?: string[]
    externallyMaintained?: string[]
    /** restores what the AFP naming filter caught by accident */
    business?: string[]
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

    const technical = isTechnical(store)
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

  // 3. data functions
  const dataFunctions = countDataFunctions(countable, usage, {
    writtenAnywhere: input.writtenAnywhere ?? new Set(),
    retStrategy: options.retStrategy ?? 'constant',
    externallyMaintained: new Set(options.boundary?.externallyMaintained ?? []),
    tables,
    weights,
  })

  // 4. transactional functions, over the stores that actually count
  const countedStores = new Map(
    dataFunctions.map((fn) => [fn.name, countable.find((store) => store.name === fn.name)!])
  )

  const ignored = new Set(options.boundary?.ignoreEntryPoints ?? [])
  const entryPoints = input.entryPoints.filter(
    (entry) => !ignored.has(entry.identity) && !ignored.has(entry.name ?? '')
  )

  const transactionalFunctions = countTransactionalFunctions(entryPoints, input.behaviors, {
    countedStores,
    root: input.app.root,
    messageDet: options.messageDet ?? 0,
    tables,
    weights,
  })

  /**
   * `opaqueReviewed` answers a warning that is CORRECT and therefore permanent.
   *
   * 1 DET for an opaque column is a floor, and `fp:count` says so on every run. But
   * some of those columns are one field — a copy, a checksum, a bag of metadata —
   * and there was no way to record that someone had looked. A warning that cannot be
   * answered is one the team learns to scroll past, which costs more than the warning
   * reports. It silences nothing else: the count does not move, and how many were
   * reviewed is still printed.
   */
  const reviewed = reviewedOpaque(options.overrides ?? {})

  const functions = applyOverrides(
    [...dataFunctions, ...transactionalFunctions],
    options.overrides ?? {},
    input.jsonSchemas ?? new Map(),
    tables,
    weights,
    warnings,
    reviewed
  )

  /**
   * Reported AFTER the overrides are applied, because the overrides are the answer
   * to it.
   *
   * Computed first, the list kept naming functions whose floor had already been
   * replaced by `detFromSchema` — telling the reader to go and map something that
   * was mapped. It cost a real misreading: a report was taken as "two forms still
   * unmapped" when both were declared, by whoever wrote this code.
   */
  const declared = new Set(
    functions
      .filter((fn) => fn.rationale.overrides?.some((o) => o.fields.includes('det')))
      .map((fn) => fn.name)
  )

  warnings.push(
    ...opaqueWarnings(countable, input, { reviewed, declared, overrides: options.overrides ?? {} })
  )
  warnings.push(...unreadableInputWarnings(input))

  return {
    ruleset: RULESET,
    rulesetVersion: RULESET_VERSION,
    functions,
    totals: totalsOf(functions),
    confidence: confidenceOf(input, warnings),
  }
}

/**
 * Columns whose content static analysis cannot read — counting-decisions §8.
 *
 * A JSON column holding a form the user fills counts as 1 DET, because the
 * schema is runtime data. That is the documented trade, and until now it was
 * documented ONLY: the count said nothing, which is the one known blind spot
 * this package reported nowhere. It reports an unresolved call, a technical
 * table, an unresolved mixin and a handler-less route — and stayed silent here.
 *
 * Only columns on a store some transaction reaches are named. An untouched
 * `metadata` column changes no number, and warning about it would be the noise
 * that teaches people to stop reading the confidence block.
 */
/**
 * Opaque DETs someone has declared reviewed, in both spellings a person might use.
 *
 * Qualified (`Petition.schema`) is unambiguous; bare (`schema`) is what someone reads
 * off the warning line.
 */
function reviewedOpaque(overrides: Record<string, FunctionOverride>): Set<string> {
  const reviewed = new Set<string>()

  for (const [name, override] of Object.entries(overrides)) {
    for (const entry of override.opaqueReviewed ?? []) {
      reviewed.add(entry)
      reviewed.add(`${name}.${entry}`)

      /**
       * The bare field too, because the two sides of this comparison spell things
       * differently. `opaqueReviewed` is written against the FUNCTION (`Petition.schema`)
       * while a rationale source carries the TABLE (`ast:petitions.schema`), and the
       * qualified form cannot be recovered from either. The last segment is what they
       * share, and without it a correctly written review matched the count and not the
       * rationale — so `fp:explain` showed no review and the override warning still
       * claimed five unanswered floors.
       */
      reviewed.add(entry.split('.').pop() ?? entry)
    }
  }

  return reviewed
}

/**
 * The identity of an opaque DET inside a rationale source.
 *
 * `ast:petitions.schema (opaque)` is the store's TABLE name, and `opaqueReviewed` is
 * written against the FUNCTION name (`Petition.schema`), so the qualified form cannot
 * be recovered from the source alone — the bare field is what both sides share.
 */
const opaqueNameOf = (source: string) =>
  source.replace(/^[a-z-]+:/, '').replace(/ \(opaque.*\)$/, '')

const shortOpaqueNameOf = (source: string) => opaqueNameOf(source).split('.').pop() ?? ''

/** `fp:explain` should say which floors someone has already looked at */
function markReviewed(sources: string[], reviewed: Set<string>): string[] {
  return sources.map((source) => {
    if (!source.endsWith('(opaque)')) return source
    const isReviewed = reviewed.has(opaqueNameOf(source)) || reviewed.has(shortOpaqueNameOf(source))
    return isReviewed ? source.replace('(opaque)', '(opaque, reviewed)') : source
  })
}

/** a column whose shape says nothing about what it holds */
const OPAQUE_TYPE = /^(object|any|unknown|Record<|Json|JSON)/

type OpaqueState = {
  reviewed: Set<string>
  declared: Set<string>
  overrides: Record<string, FunctionOverride>
}

/**
 * DETs the analysis cannot read: an opaque column, or an open input object.
 *
 * Both count 1, which is a FLOOR rather than a measurement, and counting-decisions §8
 * is the trade. Reporting it is the point — this was the one known blind spot the
 * package reported nowhere.
 *
 * Grouped by FUNCTION and stating what has already been answered, because a flat list
 * of columns could not say that. Computed before the overrides ran, it named functions
 * whose floor `detFromSchema` had already replaced, which reads as "go and map this"
 * about something already mapped. That misreading actually happened, to the author of
 * this code, reading someone else's report.
 *
 * Three states per function, and only the third is a request to do something:
 *
 *   replaced   a `detFromSchema` override stands in for one of them
 *   reviewed   someone looked and 1 is the right answer
 *   floor      still unanswered
 */
function opaqueWarnings(
  stores: CollectedDataStore[],
  input: CountInput,
  state: OpaqueState
): string[] {
  const reached = new Map<string, number>()
  for (const entry of input.entryPoints) {
    for (const store of input.behaviors.get(entry.id)?.touches ?? []) {
      reached.set(store, (reached.get(store) ?? 0) + 1)
    }
  }

  type Tally = {
    kind: string
    floor: string[]
    reviewed: number
    /** kept so an `opaqueReviewed` naming nothing can be told from one that matched */
    reviewedNames: string[]
    transactions: number
  }
  const byFunction = new Map<string, Tally>()

  const tally = (name: string, kind: string, transactions: number) => {
    const found = byFunction.get(name) ?? {
      kind,
      floor: [],
      reviewed: 0,
      reviewedNames: [],
      transactions,
    }
    byFunction.set(name, found)
    return found
  }

  for (const store of stores) {
    if (!reached.get(store.name)) continue

    for (const attribute of store.attributes) {
      if (!attribute.type || !OPAQUE_TYPE.test(attribute.type)) continue

      const entry = tally(store.name, 'column', reached.get(store.name) ?? 0)
      if (
        state.reviewed.has(`${store.name}.${attribute.name}`) ||
        state.reviewed.has(attribute.name)
      ) {
        entry.reviewed += 1
        entry.reviewedNames.push(attribute.name)
      } else {
        entry.floor.push(`${attribute.name} (${attribute.type})`)
      }
    }
  }

  for (const point of input.entryPoints) {
    for (const field of input.behaviors.get(point.id)?.opaqueInputFields ?? []) {
      const entry = tally(point.identity, 'input object', 1)
      if (state.reviewed.has(field) || state.reviewed.has(`${point.identity}.${field}`)) {
        entry.reviewed += 1
        entry.reviewedNames.push(field)
      } else {
        entry.floor.push(field)
      }
    }
  }

  /**
   * A review that matches nothing is a review that does nothing.
   *
   * `detFromSchema` already warns when it names a schema that is not declared, and
   * `opaqueReviewed` did not — so `['messages.schema']` against a field actually named
   * `createMessageValidator.messages.schema` reviewed nothing in silence while the
   * warning kept firing, which reads as the tool ignoring the configuration.
   */
  const seen = new Set<string>()
  for (const [name, entry] of byFunction) {
    for (const field of [...entry.floor, ...entry.reviewedNames]) {
      const bare = field.replace(/ \(.*\)$/, '')
      seen.add(bare)
      seen.add(`${name}.${bare}`)
      seen.add(bare.split('.').pop() ?? bare)
    }
  }

  const unmatched: string[] = []
  for (const [name, override] of Object.entries(state.overrides)) {
    for (const declaredName of override.opaqueReviewed ?? []) {
      const spellings = [
        declaredName,
        `${name}.${declaredName}`,
        declaredName.split('.').pop() ?? '',
      ]
      if (!spellings.some((spelling) => seen.has(spelling))) {
        unmatched.push(`${name}.opaqueReviewed: ${declaredName}`)
      }
    }
  }

  const lines: string[] = []
  let answered = 0

  for (const [name, entry] of byFunction) {
    /** a declared schema stands in for exactly one placeholder — §8, and the override warns when there are more */
    const replaced = state.declared.has(name) && entry.floor.length > 0 ? 1 : 0
    const remaining = entry.floor.slice(replaced)

    if (remaining.length === 0) {
      answered += 1
      continue
    }

    const answeredHere = [
      ...(replaced > 0 ? [`${replaced} replaced by override`] : []),
      ...(entry.reviewed > 0 ? [`${entry.reviewed} reviewed`] : []),
    ]

    /**
     * How many transactions reach the store, so the reader can judge whether the
     * floor is worth answering. A blob nothing touches changes no number.
     */
    const reach = entry.kind === 'column' ? `, reached by ${entry.transactions} transaction(s)` : ''

    lines.push(
      `  ${name} — ${remaining.length} ${entry.kind}(s) at 1 DET${reach}` +
        (answeredHere.length > 0 ? ` (${answeredHere.join(', ')} already)` : '') +
        /** a column is qualified by its store; an input field already names its validator */
        `: ${remaining.map((f) => (entry.kind === 'column' ? `${name}.${f}` : f)).join(', ')}`
    )
  }

  const settled =
    answered === 0
      ? []
      : [`  (${answered} more function(s) whose opaque DETs are all accounted for)`]

  const unmatchedLines =
    unmatched.length === 0
      ? []
      : [
          `${unmatched.length} \`opaqueReviewed\` entr(ies) match no opaque DET, so they review ` +
            `nothing. The name is the one the count prints:`,
          ...unmatched.map((u) => `  ${u}`),
        ]

  if (lines.length === 0) return [...unmatchedLines, ...settled]

  return [
    `${lines.length} function(s) with a DET the analysis cannot read, counted as 1 each — a FLOOR, ` +
      `not a measurement. Where the fields are declared in the source, name that schema with ` +
      `\`overrides.detFromSchema\`; where 1 is the right answer, record it with ` +
      `\`overrides.<fn>.opaqueReviewed\` — counting-decisions §8:`,
    ...lines,
    ...settled,
    ...unmatchedLines,
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
 * Replaces what the analysis found with what a person declared.
 *
 * Only for facts static analysis cannot reach — a JSON column whose schema
 * lives in the database, per counting-decisions §8. The declared number is
 * reproducible because it comes from a versioned file, and auditable because it
 * travels with its justification into the rationale, which `fp:explain` prints.
 *
 * An override naming no function is a warning, never silence: a typo in the key
 * would otherwise mean the declaration did nothing and nobody was told.
 */
function applyOverrides(
  functions: CountedFunction[],
  overrides: Record<string, FunctionOverride>,
  schemas: Map<string, DiscoveredSchema>,
  tables: Record<FunctionType, ComplexityTable>,
  weights: Record<FunctionType, Record<Complexity, number>>,
  warnings: string[],
  reviewed: Set<string>
): CountedFunction[] {
  const keys = Object.keys(overrides)
  if (keys.length === 0) return functions

  const used = new Set<string>()

  const applied = functions.map((fn) => {
    const override = overrides[fn.name]
    if (!override) return fn

    used.add(fn.name)

    const fields: ('det' | 'refs')[] = []
    if (override.det !== undefined || override.detFromSchema) fields.push('det')
    if (override.refs !== undefined) fields.push('refs')

    let det = override.det ?? fn.det
    let by = `config:overrides.${fn.name}`

    /**
     * Read from the schema rather than declared as a number.
     *
     * A frozen number goes stale the moment someone adds a field: the count
     * would not move and `fp:diff` would report no change for real functional
     * growth. Naming the schema keeps the number coming from the code, and the
     * only thing maintained by hand is the mapping — which changes when a form
     * is born, not when a field is.
     */
    if (override.detFromSchema) {
      /**
       * One name or several, unioned by leaf path.
       *
       * An ILF's DETs are the fields the user recognises in the file, and an
       * application with one schema per template recognises all of them. A field
       * two templates share is one DET, so the union is over paths rather than a
       * sum of counts.
       */
      const named = [override.detFromSchema].flat()
      const resolved = named.map((name) => schemas.get(name)).filter((s) => s !== undefined)
      const missing = named.filter((name) => !schemas.has(name))

      const union = new Set(resolved.flatMap((s) => s.leaves))
      const schema =
        resolved.length === 0
          ? undefined
          : {
              /** only what resolved: naming a schema that contributed nothing would mislead */
              name: resolved.map((s) => s.name).join(' + '),
              fields: union.size,
              leaves: [...union],
            }

      for (const name of missing) {
        warnings.push(
          `override for "${fn.name}" names schema "${name}", which is not declared ` +
            `anywhere in the code: it contributed nothing. A renamed or moved schema breaks ` +
            `the mapping, and this says so rather than counting on silently.`
        )
      }

      if (schema) {
        /**
         * Replaces the opaque placeholder — the one the rationale marks — rather
         * than assuming there is one and that it is worth 1.
         *
         * That assumption was wrong twice over. An open `vine.object` counted
         * ZERO, not 1, so subtracting 1 removed a field the analysis had read
         * correctly: 86 DETs where 87 was right. And a function with no opaque
         * DET at all was silently charged the subtraction too.
         */
        const placeholders = fn.rationale.detSources.filter((source) => source.endsWith('(opaque)'))

        det = Math.max(fn.det - Math.min(placeholders.length, 1), 0) + schema.fields
        by = `config:overrides.${fn.name} (from ${schema.name}: ${schema.fields} fields)`

        if (placeholders.length === 0) {
          warnings.push(
            `override for "${fn.name}" names schema "${schema.name}", but this function has no ` +
              `opaque DET for it to stand in for: the ${schema.fields} fields were ADDED to the ` +
              `${fn.det} already counted. Check the override is on the right function.`
          )
        } else {
          /**
           * Only the placeholders nobody has answered are worth reporting.
           *
           * The message used to count every opaque DET of the function and say "names
           * one schema" whatever it was given. With four of five columns in
           * `opaqueReviewed` and a LIST of two schemas, it still fired, still said
           * "one schema", and still counted the four already answered — a warning
           * wrong on all three counts, about a configuration that was complete.
           */
          const unanswered = placeholders.filter(
            (source) =>
              !reviewed.has(opaqueNameOf(source)) && !reviewed.has(shortOpaqueNameOf(source))
          )

          if (unanswered.length > 1) {
            warnings.push(
              `override for "${fn.name}" names ${named.length === 1 ? 'one schema' : `${named.length} schemas`} ` +
                `and the function has ${unanswered.length} unanswered opaque DETs ` +
                `(${unanswered.join(', ')}). One was replaced; the others still count 1 each — ` +
                `declare them or record them with \`opaqueReviewed\`.`
            )
          }
        }
      }
    }

    const refs = override.refs ?? fn.refs
    const complexity = complexityOf(fn.type, refs, det, tables)

    /**
     * A review is recorded with NO fields, and the reporter's "declared by override"
     * share counts only entries that declared one.
     *
     * Dropping it entirely lost the `reason`, so an `opaqueReviewed`-only decision
     * appeared nowhere — not in `fp:explain`, not anywhere — which defeats the point
     * of requiring a reason. Counting it in the share was the opposite error: it read
     * as "1 function, 7 FP, 35% of the total declared by override" when no number had
     * been declared at all.
     */
    const marked = markReviewed(fn.rationale.detSources, reviewed)

    return {
      ...fn,
      det,
      refs,
      complexity,
      points: pointsOf(fn.type, complexity, weights),
      rationale: {
        ...fn.rationale,
        detSources: marked,
        overrides: [...(fn.rationale.overrides ?? []), { by, reason: override.reason, fields }],
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
