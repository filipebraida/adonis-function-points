import type { CollectedDataStore } from '../inventory/sources/data_stores.js'
import type { Complexity, CountedFunction, FunctionType } from '../types.js'
import { complexityOf, pointsOf } from './tables.js'
import type { ComplexityTable } from './tables.js'
import { isOpaqueType } from './opaque.js'

/**
 * Data functions: ILF and EIF.
 *
 * The classification does not come from the model's own code — it comes from
 * HOW the application's transactions use the store:
 *
 *   "If the Data Function is maintained by any of the application's
 *    Transactional Functions, the Data Function shall be determined to be an
 *    ILF. […] If a Data Function is not used in any of the processing of an
 *    application's Transactional Functions, the Data Function shall not be
 *    counted in the application."  — AFP §6.5.4
 *
 * That is why this module takes usage, not just the stores. And the same
 * question — how does the application use it? — decides whether a table is a
 * data function at all or a RET of another one (counting-decisions §10).
 */

export type StoreUsage = {
  /** does any transaction of the application write to this store? */
  written: boolean
  /** does any transaction reach it at all, reading or writing? */
  used: boolean
}

export type GroupingStrategy = 'usage' | 'none'

export type GroupingOptions = {
  /**
   * `usage` folds a composition child nobody addresses directly into its parent
   * as a RET; `none` keeps every table its own data function, RET 1 — the
   * behaviour of rule sets before 1.5.0, for comparing with an old count.
   */
  grouping: GroupingStrategy
  /**
   * Stores the application addresses directly anywhere in its own code —
   * `C.query()`, `C.create()`, `new C()` — as opposed to reaching only through
   * a parent's relation. Same pass as `writtenAnywhere`, same exclusions.
   */
  addressedAnywhere: Set<string>
}

/**
 * How the stores fold into data functions.
 *
 *   rootOf        every counted store -> the store whose data function it belongs to
 *   members       root -> [root, ...children folded in]
 *   linkColumns   store -> the foreign keys that are the subgroup's LINK to its
 *                 parent, and therefore not DETs of the group
 */
export type StoreGrouping = {
  strategy: GroupingStrategy
  rootOf: Map<string, string>
  members: Map<string, string[]>
  linkColumns: Map<string, Set<string>>
  warnings: string[]
}

/**
 * A store `C` is a RET of `P` when, and only when:
 *
 *   1. `P` declares `hasMany` / `hasOne` -> `C` (collected as `subgroups`);
 *   2. no application code addresses `C` directly — the user only ever reaches
 *      it through `P`, so under the CPM it is not a logical file of its own;
 *   3. exactly one `P` satisfies (1). More than one: `C` stays apart, reported.
 *
 * Cascade delete was measured and rejected as the signal: on a real application
 * 11 of 13 cascades pointed at the tenant table. Usage is the rule the rest of
 * the count already runs on.
 */
export function groupStores(stores: CollectedDataStore[], options: GroupingOptions): StoreGrouping {
  const rootOf = new Map<string, string>()
  const members = new Map<string, string[]>()
  const linkColumns = new Map<string, Set<string>>()
  const warnings: string[] = []

  const byName = new Map(stores.map((store) => [store.name, store]))
  for (const store of stores) {
    rootOf.set(store.name, store.name)
    members.set(store.name, [store.name])
  }

  const strategy = options.grouping
  if (strategy === 'none') return { strategy, rootOf, members, linkColumns, warnings }

  /** child -> the parents declaring a composition relation to it */
  const parentsOf = new Map<string, string[]>()
  for (const store of stores) {
    for (const child of store.subgroups) {
      if (!byName.has(child)) continue
      parentsOf.set(child, [...(parentsOf.get(child) ?? []), store.name])
    }
  }

  const parentChosen = new Map<string, string>()

  for (const [child, parents] of [...parentsOf.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (options.addressedAnywhere.has(child)) continue

    if (parents.length > 1) {
      warnings.push(
        `not grouped: ${child} is a composition child of ${parents.sort().join(' and ')} and no ` +
          `application code addresses it directly. Which parent it belongs to is not derivable ` +
          `from the code, so it stays its own data function.`
      )
      continue
    }

    parentChosen.set(child, parents[0])
  }

  /** follow parent -> parent up to a store that is its own root; a cycle stops at the child */
  const rootFor = (child: string): string => {
    let current = child
    const seen = new Set<string>()
    while (parentChosen.has(current) && !seen.has(current)) {
      seen.add(current)
      current = parentChosen.get(current)!
    }
    return seen.has(current) ? child : current
  }

  for (const [child, parent] of parentChosen) {
    const root = rootFor(child)
    if (root === child) continue

    rootOf.set(child, root)
    members.get(root)!.push(child)
    members.delete(child)
    linkColumns.set(child, foreignKeysTo(byName.get(child)!, parent))

    warnings.push(
      `grouped: ${child} is a RET of ${root} — ${parent} declares hasMany/hasOne to it, and no ` +
        `application code addresses it directly (counting-decisions §10)`
    )
  }

  // the root first — it is the main group — then its children, in a stable order
  for (const [root, list] of members) {
    members.set(root, [root, ...list.filter((member) => member !== root).sort()])
  }

  return { strategy, rootOf, members, linkColumns, warnings }
}

/**
 * The child's foreign keys to its parent, by Lucid's convention: the
 * `belongsTo` property plus `Id`. Inside one logical file that key is the
 * subgroup's link, not an attribute the user recognises. A key to a DIFFERENT
 * data function still counts, as IFPUG requires.
 */
function foreignKeysTo(child: CollectedDataStore, parent: string): Set<string> {
  const names = new Set(child.attributes.map((attribute) => attribute.name))
  const keys = new Set<string>()

  for (const [property, target] of Object.entries(child.relations)) {
    if (target !== parent) continue
    const key = `${property}Id`
    if (names.has(key)) keys.add(key)
  }

  return keys
}

/** the DET attributes of one store: not the key, not a system stamp, not a link to its parent */
export function detAttributesOf(store: CollectedDataStore, links: Set<string> = new Set()) {
  return store.attributes.filter(
    (attribute) => !attribute.isIdentifier && !attribute.system && !links.has(attribute.name)
  )
}

export type DataFunctionOptions = {
  grouping: StoreGrouping
  /** stores maintained by another system, by boundary decision */
  externallyMaintained: Set<string>
  /**
   * Stores the application writes anywhere in its code — a job, a seeder, a
   * command — whether or not a route reaches that write. §6.5.4 asks who
   * maintains the store, not which route does.
   */
  writtenAnywhere: Set<string>
  tables: Record<FunctionType, ComplexityTable>
  weights: Record<FunctionType, Record<Complexity, number>>
}

export function countDataFunctions(
  stores: CollectedDataStore[],
  usage: Map<string, StoreUsage>,
  options: DataFunctionOptions
): CountedFunction[] {
  const counted: CountedFunction[] = []
  const byName = new Map(stores.map((store) => [store.name, store]))
  const { rootOf, members, linkColumns } = options.grouping

  for (const store of stores) {
    // a child folded into its parent is counted there, as a RET
    if (rootOf.get(store.name) !== store.name) continue

    const group = (members.get(store.name) ?? [store.name])
      .map((name) => byName.get(name))
      .filter((member): member is CollectedDataStore => member !== undefined)

    /**
     * Usage and maintenance are properties of the GROUP: a transaction that
     * reaches or writes the detail reaches or writes the logical file.
     */
    const use = group.reduce(
      (total, member) => {
        const each = usage.get(member.name)
        return {
          used: total.used || each?.used === true,
          written: total.written || each?.written === true,
        }
      },
      { used: false, written: false }
    )

    // AFP §6.5.4: a store no transaction reaches is not counted
    if (!use.used) continue

    /**
     * DETs exclude the technical identifier, the system timestamps, and — for a
     * child folded in — its link to the parent.
     *
     * IFPUG defines a DET as a "user recognizable" attribute, and an
     * auto-increment surrogate key is not something the user recognises.
     * Counting it would inflate every data function by one. A column the
     * framework stamps (`autoCreate` / `autoUpdate`) is the same kind of field —
     * counting-decisions §6.
     */
    const detSources: string[] = []
    let det = 0
    for (const member of group) {
      for (const attribute of detAttributesOf(member, linkColumns.get(member.name))) {
        det++
        detSources.push(
          `${member.columnSource}:${member.table ?? member.name}.${attribute.name}` +
            (isOpaqueType(attribute.type) ? ' (opaque)' : '')
        )
      }
    }

    const refs = group.length

    /**
     * Maintained by the application, or by another system?
     *
     * A write reachable from an entry point is the common case. A write from a
     * job maintains the store just as much — AFP §6.5.4 asks who maintains it,
     * not which route does.
     */
    const maintained =
      use.written || group.some((member) => options.writtenAnywhere.has(member.name))
    const declaredExternal = group.some((member) => options.externallyMaintained.has(member.name))
    const external = declaredExternal || !maintained
    const type: FunctionType = external ? 'EIF' : 'ILF'

    const complexity = complexityOf(type, refs, det, options.tables)

    counted.push({
      /**
       * Identity is the physical table — counting-decisions §5 — never the class.
       * Renaming a model is implementation; keyed by the class it billed as a
       * deletion plus an addition for zero functional change.
       */
      id: `data:${store.table ?? store.name}`,
      name: store.name,
      module: store.module,
      type,
      det,
      refs,
      complexity,
      points: pointsOf(type, complexity, options.weights),
      rationale: {
        rule: declaredExternal
          ? 'afp:6.5.4 externally maintained by boundary configuration -> EIF'
          : maintained
            ? 'afp:6.5.4 maintained by an application transaction -> ILF'
            : 'afp:6.5.4 used but not maintained -> EIF',
        detSources,
        refSources: [
          options.grouping.strategy === 'none'
            ? `1 (grouping disabled: every table is its own data function)`
            : `1 (main group: ${store.table ?? store.name})`,
          ...group.slice(1).map((member) => {
            const links = [...(linkColumns.get(member.name) ?? [])].join(', ') || 'none found'
            return (
              `subgroup:${member.name} — a composition child no application code addresses ` +
              `directly; its link to the parent (${links}) is not a DET`
            )
          }),
        ],
      },
    })
  }

  return counted
}
