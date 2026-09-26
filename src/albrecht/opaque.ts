import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { DiscoveredSchema } from '../inventory/sources/json_schemas.js'
import type { CollectedEntryPoint } from '../inventory/sources/routes_ast.js'
import type { Behavior } from '../inventory/graph/call_graph.js'
import type { Complexity, CountedFunction, FunctionType } from '../types.js'
import { complexityOf, pointsOf } from './tables.js'
import type { ComplexityTable } from './tables.js'

/**
 * DETs the analysis cannot read, and what a person declared about them —
 * counting-decisions §8 and §9.
 *
 * Three shapes are opaque: a JSON column (`ast:petitions.components`), an open
 * input object (`validator:savePetitionValidator.components`), and a spread a
 * transformer emits (`transformer:X.<this.resource.serialize()>`). Each counts
 * 1 DET — a floor, never a zero — and is marked `(opaque)` in the rationale.
 *
 * A declaration is about the ORIGIN of the placeholder, not about a function,
 * and it applies to every function that carries the DET: the data function and
 * each transaction that takes or shows the column. Keyed by function it had to
 * be written twice and still missed the third place, so the same column was
 * worth two numbers in one count — and matching by bare name meant reviewing
 * `Message.schema` reviewed every `schema` column of every table.
 */

export const OPAQUE_TYPE = /^(object|any|unknown|Record<|Json|JSON)/
export const isOpaqueType = (type?: string) => type !== undefined && OPAQUE_TYPE.test(type)

export type OpaqueDeclaration = {
  /**
   * Name(s) of a JSON Schema declared in the application's code, whose fields
   * are counted by the §7 leaf rules and replace the single DET the placeholder
   * contributed. Several are unioned by leaf path: a field two templates share
   * counts once.
   *
   * Prefer this to `overrides.<fn>.det`. A declared number freezes; naming the
   * schema keeps the number coming from the code, and the only thing maintained
   * by hand is the mapping — which changes when a form is born, not when a field
   * is. A name that matches no schema is a warning, never a silent fallback.
   */
  schemas?: string | string[]
  /**
   * Someone looked, and 1 is the right answer — a copy, a checksum, a bag of
   * metadata. Moves no number; stops the warning for this origin; is printed by
   * `fp:explain` with its reason, and is not counted in the "declared by override"
   * share, because nothing was declared.
   */
  reviewed?: true
  /** why — required, and printed beside the number */
  reason: string
}

const OPAQUE = ' (opaque)'
const REVIEWED = ' (opaque, reviewed)'

/** the origin of a placeholder, spelled the way the configuration keys it */
function originOf(source: string, storeOfTable: Map<string, string>): string | null {
  if (!source.endsWith(OPAQUE)) return null

  const body = source.slice(0, -OPAQUE.length)
  const colon = body.indexOf(':')
  const prefix = body.slice(0, colon)
  const rest = body.slice(colon + 1)

  switch (prefix) {
    case 'ast':
    case 'generated-schema': {
      // `table.column` on the data function; the key is the MODEL's name
      const dot = rest.indexOf('.')
      const table = rest.slice(0, dot)
      return `${storeOfTable.get(table) ?? table}.${rest.slice(dot + 1)}`
    }
    case 'output':
    case 'validator':
    case 'transformer':
      return rest
    default:
      return null
  }
}

export type ApplyOpaqueOptions = {
  declarations: Record<string, OpaqueDeclaration>
  stores: CollectedDataStore[]
  schemas: Map<string, DiscoveredSchema>
  tables: Record<FunctionType, ComplexityTable>
  weights: Record<FunctionType, Record<Complexity, number>>
}

export type AppliedOpaque = {
  functions: CountedFunction[]
  /** origin -> how it was answered */
  answered: Map<string, 'replaced' | 'reviewed'>
  warnings: string[]
}

/**
 * Applies the declarations to every function carrying the origin they name.
 *
 *   schemas    the placeholder's 1 DET becomes the schema's leaves, and the line
 *              says which schema stood in
 *   reviewed   the placeholder stays 1, marked reviewed; the warning stops
 *
 * A declaration keyed by the physical table (`petitions.components`) is accepted
 * as well as one keyed by the model (`Petition.components`): the count prints
 * the model, `fp:explain` prints the table, and a person copies from either.
 */
export function applyOpaque(
  functions: CountedFunction[],
  options: ApplyOpaqueOptions
): AppliedOpaque {
  const storeOfTable = new Map(
    options.stores.map((store) => [store.table ?? store.name, store.name])
  )

  /** declarations by the origin the rationale will produce */
  const declared = new Map<string, { key: string; declaration: OpaqueDeclaration }>()
  for (const [key, declaration] of Object.entries(options.declarations)) {
    const dot = key.indexOf('.')
    const head = dot === -1 ? key : key.slice(0, dot)
    const normalised = dot === -1 ? key : `${storeOfTable.get(head) ?? head}.${key.slice(dot + 1)}`
    declared.set(normalised, { key, declaration })
  }

  const answered = new Map<string, 'replaced' | 'reviewed'>()
  const used = new Set<string>()
  const warnings: string[] = []
  const warned = new Set<string>()

  const resolveSchemas = (key: string, names: string[]) => {
    const resolved = names
      .map((name) => options.schemas.get(name))
      .filter((schema): schema is DiscoveredSchema => schema !== undefined)

    for (const name of names) {
      if (options.schemas.has(name) || warned.has(`${key}:${name}`)) continue
      warned.add(`${key}:${name}`)
      warnings.push(
        `opaque declaration "${key}" names schema "${name}", which is not declared anywhere ` +
          `in the code: it contributed nothing. A renamed or moved schema breaks the mapping, ` +
          `and this says so rather than counting on silently.`
      )
    }

    if (resolved.length === 0) return null

    /** unioned by leaf path: a field two templates share is one DET */
    const leaves = new Set(resolved.flatMap((schema) => schema.leaves))
    return { name: resolved.map((schema) => schema.name).join(' + '), fields: leaves.size }
  }

  const applied = functions.map((fn) => {
    let det = fn.det
    const sources: string[] = []
    const overrides = [...(fn.rationale.overrides ?? [])]
    const recorded = new Set<string>()

    for (const source of fn.rationale.detSources) {
      const origin = originOf(source, storeOfTable)
      const found = origin ? declared.get(origin) : undefined

      if (!origin || !found) {
        sources.push(source)
        continue
      }

      const { key, declaration } = found
      used.add(origin)
      const body = source.slice(0, -OPAQUE.length)

      if (declaration.schemas) {
        const schema = resolveSchemas(key, [declaration.schemas].flat())

        if (!schema) {
          sources.push(source)
          continue
        }

        det += schema.fields - 1
        sources.push(`${body} → ${schema.name} (${schema.fields} fields)`)
        answered.set(origin, 'replaced')

        if (!recorded.has(key)) {
          recorded.add(key)
          overrides.push({
            by: `config:opaque.${key} (from ${schema.name}: ${schema.fields} fields)`,
            reason: declaration.reason,
            fields: ['det'],
          })
        }
        continue
      }

      if (declaration.reviewed) {
        sources.push(body + REVIEWED)
        answered.set(origin, 'reviewed')

        if (!recorded.has(key)) {
          recorded.add(key)
          overrides.push({ by: `config:opaque.${key}`, reason: declaration.reason, fields: [] })
        }
        continue
      }

      sources.push(source)
    }

    if (det === fn.det && overrides.length === (fn.rationale.overrides?.length ?? 0)) return fn

    const complexity = complexityOf(fn.type, fn.refs, det, options.tables)
    return {
      ...fn,
      det,
      complexity,
      points: pointsOf(fn.type, complexity, options.weights),
      rationale: { ...fn.rationale, detSources: sources, overrides },
    }
  })

  for (const [origin, { key }] of declared) {
    if (used.has(origin)) continue
    warnings.push(
      `opaque declaration "${key}" matches no DET the analysis found opaque: it had no effect. ` +
        `The origins it can answer are the ones \`fp:count\` lists — \`Store.column\` or ` +
        `\`validator.field\`.`
    )
  }

  return { functions: applied, answered, warnings }
}

export type OpaqueReportInput = {
  functions: CountedFunction[]
  stores: CollectedDataStore[]
  entryPoints: CollectedEntryPoint[]
  behaviors: Map<string, Behavior>
  answered: Map<string, 'replaced' | 'reviewed'>
}

/**
 * The floors still standing, by origin — the one blind spot this package used
 * to keep to itself.
 *
 * Grouped by origin because that is what a declaration answers: one line for
 * `Form.definition` however many transactions show it. A transformer's spread has
 * its own warning and is not repeated here. Only what is unanswered is a request
 * to do something; what was answered is counted at the end so the fact is
 * recorded rather than erased.
 */
export function opaqueWarnings(input: OpaqueReportInput): string[] {
  const storeOfTable = new Map(input.stores.map((store) => [store.table ?? store.name, store.name]))
  const typeOf = new Map<string, string>()
  for (const store of input.stores) {
    for (const attribute of store.attributes) {
      if (attribute.type) typeOf.set(`${store.name}.${attribute.name}`, attribute.type)
    }
  }

  /** how many transactions reach each store, so the reader can judge a column's weight */
  const reached = new Map<string, number>()
  for (const entry of input.entryPoints) {
    for (const store of input.behaviors.get(entry.id)?.touches ?? []) {
      reached.set(store, (reached.get(store) ?? 0) + 1)
    }
  }

  type Floor = { kind: 'column' | 'input object'; carriers: string[] }
  const floors = new Map<string, Floor>()

  for (const fn of input.functions) {
    for (const source of fn.rationale.detSources) {
      const origin = originOf(source, storeOfTable)
      if (!origin || source.startsWith('transformer:')) continue

      const kind = source.startsWith('validator:') ? 'input object' : 'column'
      const floor = floors.get(origin) ?? { kind, carriers: [] }
      if (!floor.carriers.includes(fn.name)) floor.carriers.push(fn.name)
      floors.set(origin, floor)
    }
  }

  const lines = [...floors.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([origin, floor]) => {
      if (floor.kind === 'input object')
        return `  ${origin} — input object on ${floor.carriers.join(', ')}`

      const store = origin.slice(0, origin.indexOf('.'))
      const type = typeOf.get(origin)
      return (
        `  ${origin}${type ? ` (${type})` : ''} — column on ${store}, ` +
        `reached by ${reached.get(store) ?? 0} transaction(s)`
      )
    })

  const replaced = [...input.answered.values()].filter((how) => how === 'replaced').length
  const reviewed = [...input.answered.values()].filter((how) => how === 'reviewed').length
  const settled =
    replaced + reviewed === 0
      ? []
      : [
          `  (already answered: ` +
            [
              ...(replaced > 0 ? [`${replaced} replaced by a schema`] : []),
              ...(reviewed > 0 ? [`${reviewed} reviewed`] : []),
            ].join(', ') +
            `)`,
        ]

  if (lines.length === 0) return settled

  return [
    `${lines.length} DET(s) the analysis cannot read, counted as 1 each — a FLOOR, not a ` +
      `measurement. Where the fields are declared in the source, name that schema with ` +
      `\`opaque.<origin>.schemas\`; where 1 is the right answer, record it with ` +
      `\`opaque.<origin>.reviewed\` — counting-decisions §8:`,
    ...lines,
    ...settled,
  ]
}
