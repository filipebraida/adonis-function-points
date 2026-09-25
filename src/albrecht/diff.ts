import type {
  ChangeReason,
  ChangeType,
  CountResult,
  CountedFunction,
  DiffEntry,
  DiffResult,
} from '../types.js'

/**
 * Added, changed and removed functions between two counts — what becomes an
 * invoice.
 *
 * Normative base: **OMG Automated Enhancement Points 1.0**, the sibling of AFP,
 * written to size maintenance between two revisions.
 *
 *   "Each Artifact shall be analyzed in both revisions to determine whether it
 *    is: Added — when it exists in revision ToRevision while it didn't exist in
 *    FromRevision. […] Modified — when it exists in both revisions but whose
 *    source code changed."  — AEP §6.3
 *
 * Two decisions make this workable:
 *
 * 1. **It operates on two saved counts**, never on two checkouts. Booting the
 *    older revision, with possibly different dependencies, is the kind of
 *    problem not worth solving.
 * 2. **It refuses to compare different rule sets.** If the rules changed in
 *    between, the difference measures the rule change, not the work — and the
 *    result would go into an invoice.
 */

export class IncomparableRulesetsError extends Error {
  constructor(from: string, to: string) {
    super(
      `counts from different rule sets are not comparable: ${from} vs ${to}. ` +
        `The rules changed between the two measurements, so the difference does ` +
        `not measure work — it measures the rule change.`
    )
    this.name = 'IncomparableRulesetsError'
  }
}

/**
 * Factors per change type.
 *
 * The `added` and `removed` defaults are the explicit anchors of AEP §6.5: an
 * added transaction is worth 1, a deleted one 0.4.
 *
 * `changed` defaults to 1 and **that overestimates**. AEP grades it from 0.25
 * to 1.75 through Table 6.1, derived from Effort Complexity variation, which
 * requires cyclomatic complexity that this package does not yet measure.
 * Counting 1 is conservative in the sense of not inventing a number, not in the
 * sense of billing less — and the result says so.
 */
export type ChangeFactors = Record<ChangeType, number>

export const AEP_FACTORS: ChangeFactors = {
  added: 1,
  changed: 1,
  removed: 0.4,
  unchanged: 0,
}

/**
 * Factors for a modified function, by WHAT changed about it.
 *
 * The distinction is already measured — `type`, `size` and `implementation` come
 * out of the same comparison — and pricing all three at 1 throws that away. It
 * showed up on a real pair of releases: of 378 FP billed as changed, 151 came
 * from functions whose type, DET and FTR were all identical and only the body
 * differed. Charging a refactor at full functional value is not defensible, and
 * charging it at a number this package invented would be worse.
 *
 * So no default changes: each reason falls back to `factors.changed`, and the
 * contract sets what it agreed to price. What the tool owes is the split.
 */
export type ChangeReasonFactors = Partial<Record<ChangeReason, number>>

export type DiffOptions = {
  factors?: Partial<ChangeFactors>
  /** per-reason factors for modified functions; each falls back to `factors.changed` */
  reasonFactors?: ChangeReasonFactors
  /** labels for the two measurements, for the report only */
  labels?: { from: string; to: string }
}

export type FunctionPointDiff = DiffResult & {
  /** function points weighted by the factors — this is what gets billed */
  billable: number
  factors: ChangeFactors
  /** what the modified functions were actually billed at, by reason */
  reasonFactors: ChangeReasonFactors
  warnings: string[]
}

/**
 * Two counts of DIFFERENT applications compare cleanly and mean nothing.
 *
 * The ruleset guard already refuses counts produced by different rules. This
 * refuses counts produced over different subjects, which is the same class of
 * error and the easier one to make in CI, where both files arrive as paths.
 */
export class IncomparableSourcesError extends Error {
  constructor(
    readonly from: string,
    readonly to: string
  ) {
    super(
      `refusing to compare counts of different applications: "${from}" and "${to}". ` +
        `The difference would not measure work, it would measure that the two files ` +
        `are about different things.`
    )
    this.name = 'IncomparableSourcesError'
  }
}

export function diffCounts(
  from: CountResult,
  to: CountResult,
  options: DiffOptions = {}
): FunctionPointDiff {
  if (from.rulesetVersion !== to.rulesetVersion || from.ruleset !== to.ruleset) {
    throw new IncomparableRulesetsError(
      `${from.ruleset}@${from.rulesetVersion}`,
      `${to.ruleset}@${to.rulesetVersion}`
    )
  }

  if (from.source && to.source && from.source.app !== to.source.app) {
    throw new IncomparableSourcesError(from.source.app, to.source.app)
  }

  const factors = { ...AEP_FACTORS, ...options.factors }
  const reasonFactors = options.reasonFactors ?? {}

  /** the factor a single entry is billed at, which is the per-reason one when set */
  const factorFor = (entry: DiffEntry) =>
    entry.change === 'changed' && entry.reason
      ? (reasonFactors[entry.reason] ?? factors.changed)
      : factors[entry.change]
  const before = new Map(from.functions.map((fn) => [fn.id, fn]))
  const after = new Map(to.functions.map((fn) => [fn.id, fn]))

  const entries: DiffEntry[] = []

  for (const [id, fn] of after) {
    const previous = before.get(id)
    if (!previous) {
      entries.push({ function: fn, change: 'added' })
      continue
    }
    const reason = reasonBetween(previous, fn)
    entries.push({
      function: fn,
      change: reason ? 'changed' : 'unchanged',
      previous,
      ...(reason ? { reason } : {}),
    })
  }

  for (const [id, fn] of before) {
    if (!after.has(id)) entries.push({ function: fn, change: 'removed' })
  }

  const warnings: string[] = []

  /**
   * Provenance warnings. None of them stops the comparison — they qualify the
   * number that comes out of it, which is what goes onto an invoice.
   */
  for (const [side, count] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (!count.source) {
      warnings.push(
        `the "${side}" count records no source: it cannot be tied to a revision, ` +
          `so this difference cannot be reproduced or audited later.`
      )
      continue
    }

    if (count.source.dirty) {
      warnings.push(
        `the "${side}" count was taken over a tree with uncommitted changes ` +
          `(${count.source.app}${count.source.revision ? ` at ${count.source.revision.slice(0, 8)}` : ''}): ` +
          `no revision reproduces it.`
      )
    }
  }

  if (
    from.source?.revision &&
    from.source.revision === to.source?.revision &&
    !from.source.dirty &&
    !to.source.dirty
  ) {
    warnings.push(
      `both counts are of the same revision (${from.source.revision.slice(0, 8)}): ` +
        `any difference here comes from the tool or its configuration, not from work done.`
    )
  }

  /**
   * Quantified, because the generic sentence was not actionable.
   *
   * On a real pair of releases this warning sat under 118 lines of per-function
   * output, saying only that the factor was pinned. What a client disputes is
   * the amount, so the amount is what it has to say.
   */
  const changedPoints = entries
    .filter((entry) => entry.change === 'changed')
    .reduce((total, entry) => total + entry.function.points, 0)

  if (changedPoints > 0 && factors.changed === 1 && reasonFactors.implementation === undefined) {
    const byReason = changedByReasonOf(entries)
    const billable = round2(
      entries.reduce((total, entry) => total + entry.function.points * factorFor(entry), 0)
    )
    const share = billable === 0 ? 0 : Math.round((changedPoints / billable) * 100)

    warnings.push(
      `${changedPoints} of ${billable} billable FP (${share}%) are modified functions at a ` +
        `factor pinned to 1. AEP grades it from 0.25 to 1.75 through Effort Complexity ` +
        `variation, which needs cyclomatic complexity — not measured yet. Of those, ` +
        `${byReason.implementation.points} FP changed implementation only (same type, DET ` +
        `and FTR): set \`reasonFactors\` to price that differently.`
    )
  }

  return {
    from: options.labels?.from ?? 'previous',
    to: options.labels?.to ?? 'current',
    entries: entries.sort(byChangeThenName),
    totals: totalsOf(entries),
    changedByReason: changedByReasonOf(entries),
    /**
     * Rounded to cents at the source, not at the print.
     *
     * `485.00000000000006` appeared on the first real diff. It is arithmetically
     * the same number and it is not the same document: this value is quoted in
     * an invoice, and a reader who sees that tail stops trusting the rest.
     */
    billable: round2(
      entries.reduce((total, entry) => total + entry.function.points * factorFor(entry), 0)
    ),
    factors,
    reasonFactors,
    warnings,
  }
}

/**
 * What counts as a change.
 *
 * A change in the implementation scope (checksum of the normalised AST) **or**
 * in the functional size. Formatting and comments do not count: the hash
 * already ignores them.
 *
 * Renaming a route does not show up here because identity is
 * `(verb, pattern)` — and neither does moving a controller between modules,
 * which is implementation.
 */
/**
 * Why the function changed, or null when it did not.
 *
 * Reported by the most consequential cause: a reclassification usually moves
 * the size too, and naming the type is the fact that explains the rest. The
 * rendered line carries the DET and FTR movement, so nothing is hidden behind
 * the label.
 */
function reasonBetween(previous: CountedFunction, current: CountedFunction): ChangeReason | null {
  if (previous.type !== current.type) return 'type'
  if (previous.det !== current.det || previous.refs !== current.refs) return 'size'
  if ((previous.scopeHash ?? '') !== (current.scopeHash ?? '')) return 'implementation'
  return null
}

/**
 * Where an invoice actually comes from.
 *
 * `changed` is usually the largest line, and until this split it said nothing
 * about whether it was paying for growth or for refactoring.
 */
function changedByReasonOf(entries: DiffEntry[]): DiffResult['changedByReason'] {
  const byReason: DiffResult['changedByReason'] = {
    type: { count: 0, points: 0 },
    size: { count: 0, points: 0 },
    implementation: { count: 0, points: 0 },
  }

  for (const entry of entries) {
    if (entry.change !== 'changed' || !entry.reason) continue
    byReason[entry.reason].count++
    byReason[entry.reason].points += entry.function.points
  }

  return byReason
}

const ORDER: Record<ChangeType, number> = { added: 0, changed: 1, removed: 2, unchanged: 3 }

const byChangeThenName = (a: DiffEntry, b: DiffEntry) =>
  ORDER[a.change] - ORDER[b.change] || a.function.name.localeCompare(b.function.name)

function totalsOf(entries: DiffEntry[]): DiffResult['totals'] {
  const totals: DiffResult['totals'] = {
    added: { count: 0, points: 0 },
    changed: { count: 0, points: 0 },
    removed: { count: 0, points: 0 },
    unchanged: { count: 0, points: 0 },
  }

  for (const entry of entries) {
    totals[entry.change].count++
    totals[entry.change].points += entry.function.points
  }

  return totals
}

/** two decimals: this number is quoted in an invoice */
const round2 = (value: number) => Math.round(value * 100) / 100
