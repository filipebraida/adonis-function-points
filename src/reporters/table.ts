import type { CountResult, CountedFunction } from '../types.js'
import type { FunctionPointDiff } from '../albrecht/diff.js'

/**
 * Text reports.
 *
 * They return a string instead of printing: that is what makes them testable
 * without capturing output, and it keeps each ace command down to
 * `this.logger.log(render(...))`.
 */

const pad = (value: string | number, width: number) => String(value).padEnd(width)
const padStart = (value: string | number, width: number) => String(value).padStart(width)

export function renderCount(result: CountResult): string {
  const lines: string[] = []

  lines.push(`Unadjusted count: ${result.totals.unadjusted} FP`)
  lines.push(`Ruleset: ${result.ruleset}@${result.rulesetVersion}`)
  lines.push('')

  lines.push(`${pad('type', 6)}${padStart('n', 5)}${padStart('FP', 7)}`)
  for (const [type, value] of Object.entries(result.totals.byType)) {
    if (value.count === 0) continue
    lines.push(`${pad(type, 6)}${padStart(value.count, 5)}${padStart(value.points, 7)}`)
  }

  lines.push('')
  lines.push(
    `${pad('function', 40)}${pad('type', 6)}${padStart('DET', 5)}${padStart('FTR', 5)}${padStart('FP', 5)}`
  )
  for (const fn of result.functions) {
    lines.push(
      `${pad(fn.name.slice(0, 39), 40)}${pad(fn.type, 6)}${padStart(fn.det, 5)}` +
        `${padStart(fn.refs, 5)}${padStart(fn.points, 5)}`
    )
  }

  /**
   * Confidence comes right after the number, never hidden. AFP §6.5.3 requires
   * whatever could not be traced to appear in the report.
   */
  const { unresolvedCalls, entryPointsWithoutHandler, warnings } = result.confidence
  if (unresolvedCalls > 0 || entryPointsWithoutHandler > 0 || warnings.length > 0) {
    lines.push('')
    lines.push('Confidence:')
    if (unresolvedCalls > 0) lines.push(`  ${unresolvedCalls} unresolved calls`)
    if (entryPointsWithoutHandler > 0) {
      lines.push(`  ${entryPointsWithoutHandler} entry points without a handler`)
    }
    for (const warning of warnings) lines.push(`  ${warning}`)
  }

  return lines.join('\n')
}

/** `fp:explain`: a function's provenance, which is what supports a dispute */
export function renderExplain(fn: CountedFunction): string {
  const lines: string[] = []

  lines.push(`${fn.name}  —  ${fn.type}, ${fn.complexity} complexity, ${fn.points} FP`)
  lines.push(`module: ${fn.module}`)
  lines.push('')
  lines.push(`Rule applied: ${fn.rationale.rule}`)

  lines.push('')
  lines.push(`DET = ${fn.det}`)
  for (const source of fn.rationale.detSources) lines.push(`  ${source}`)

  lines.push('')
  lines.push(`${fn.type === 'ILF' || fn.type === 'EIF' ? 'RET' : 'FTR'} = ${fn.refs}`)
  for (const source of fn.rationale.refSources) lines.push(`  ${source}`)

  if (fn.rationale.trace?.length) {
    lines.push('')
    lines.push('Path walked:')
    for (const step of fn.rationale.trace) {
      const marca = step.writes ? ' [writes]' : ''
      lines.push(
        `  ${'  '.repeat(step.depth)}${step.file.split('/').slice(-2).join('/')}` +
          `#${step.member ?? 'handle'}  (${step.by})${marca}`
      )
    }
  }

  if (fn.rationale.overrides?.length) {
    lines.push('')
    lines.push('Manual overrides:')
    for (const override of fn.rationale.overrides) {
      lines.push(`  ${override.by}: ${override.reason}`)
    }
  }

  return lines.join('\n')
}

/** `fp:diff`: added, changed and removed — what becomes an invoice */
export function renderDiff(diff: FunctionPointDiff): string {
  const lines: string[] = []

  lines.push(`${diff.from} -> ${diff.to}`)
  lines.push('')

  for (const [change, total] of Object.entries(diff.totals)) {
    if (total.count === 0) continue
    const factor = diff.factors[change as keyof typeof diff.factors]
    lines.push(
      `${pad(change, 11)}${padStart(total.count, 4)} functions` +
        `${padStart(total.points, 6)} FP  × ${factor}`
    )
  }

  lines.push('')
  lines.push(`Billable FP: ${diff.billable}`)

  const mudou = diff.entries.filter((entry) => entry.change !== 'unchanged')
  if (mudou.length > 0) {
    lines.push('')
    for (const entry of mudou) {
      lines.push(
        `  ${pad(entry.change, 10)} ${pad(entry.function.name.slice(0, 44), 45)}` +
          `${padStart(entry.function.points, 4)} PF`
      )
    }
  }

  for (const warning of diff.warnings) {
    lines.push('')
    lines.push(`Warning: ${warning}`)
  }

  return lines.join('\n')
}
