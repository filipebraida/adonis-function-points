import { readFile, writeFile } from 'node:fs/promises'

import { analyze } from '../pipeline.js'
import { calibrate, parseSamples } from '../albrecht/calibration.js'
import { IncomparableRulesetsError, diffCounts } from '../albrecht/diff.js'
import { renderCount, renderDiff, renderExplain } from '../reporters/table.js'
import { loadConfig } from './load_config.js'
import type { CountResult } from '../types.js'

/**
 * What each command actually does, with no front-end attached.
 *
 * There are two front-ends — the ace commands, for a project that installed the
 * package, and the standalone binary, for CI — and a rule that keeps them
 * honest: **they must not be able to disagree**. Everything that decides a
 * number lives here; the front-ends only parse arguments and print.
 *
 * Loading `config/function_points.ts` is part of that. It used to happen in
 * neither front-end, so every option but `--min-coverage` was silently ignored
 * by the command a user actually runs, while the tests proved the options
 * worked by calling `analyze()` directly.
 */

export type RunResult = {
  /** what to print on stdout */
  output: string
  /** lines to report as errors; a non-empty list means failure */
  errors?: string[]
  /** notes about the run itself, printed before the output */
  notes?: string[]
}

type Common = { root: string }

/**
 * An empty inventory is never a number.
 *
 * Both front-ends can be pointed at a directory that is not the application —
 * a monorepo root is the common case — and the symptom is not an error, it is
 * a confident zero: 0 FP at 100% coverage, exit 0, CI green. Counting nothing
 * and reporting nothing are indistinguishable from the outside, so the only
 * safe answer is to refuse.
 */
function refuseIfEmpty(root: string, stores: number, entryPoints: number): string[] | null {
  if (stores > 0 || entryPoints > 0) return null

  return [
    `found no data stores and no entry points in ${root}.`,
    `That is not a count of zero — it is a failure to find the application.`,
    `Check that --root points at the AdonisJS application (apps/<name> in a monorepo).`,
  ]
}

/** every run says which configuration produced it — provenance starts here */
async function configFor(root: string) {
  const { config, file } = await loadConfig(root)
  const notes = file
    ? [`config: ${file}`]
    : ['config: defaults (no config/function_points.ts found)']
  return { config, notes }
}

export async function runInventory(options: Common & { out?: string }): Promise<RunResult> {
  const { config, notes } = await configFor(options.root)
  const { inventory } = await analyze(options.root, config)

  const empty = refuseIfEmpty(
    options.root,
    inventory.dataStores.length,
    inventory.entryPoints.length
  )
  if (empty) return { output: '', notes, errors: empty }

  if (options.out) {
    await writeFile(options.out, JSON.stringify(inventory, null, 2))
    return { output: `inventory written to ${options.out}`, notes }
  }

  const { coverage } = inventory
  return {
    notes,
    output: [
      `data stores:   ${inventory.dataStores.length}`,
      `entry points:  ${coverage.entryPointsTotal}`,
      `coverage:      ${(coverage.ratio * 100).toFixed(1)}% ` +
        `(${coverage.unresolvedCalls} unresolved calls)`,
    ].join('\n'),
  }
}

export async function runCount(
  options: Common & { out?: string; json?: boolean; minCoverage?: number }
): Promise<RunResult> {
  const { config, notes } = await configFor(options.root)

  // an explicit flag beats the config file: it is the more local intent
  const { inventory, count } = await analyze(options.root, {
    ...config,
    minCoverage: options.minCoverage ?? config.minCoverage,
  })

  const empty = refuseIfEmpty(
    options.root,
    inventory.dataStores.length,
    inventory.entryPoints.length
  )
  if (empty) return { output: '', notes, errors: empty }

  if (options.out) {
    await writeFile(options.out, JSON.stringify(count, null, 2))
    notes.push(`count written to ${options.out}`)
  }

  return { notes, output: options.json ? JSON.stringify(count, null, 2) : renderCount(count) }
}

export async function runExplain(options: Common & { name: string }): Promise<RunResult> {
  const { config, notes } = await configFor(options.root)
  const { count } = await analyze(options.root, config)

  const matched = count.functions.filter((fn) =>
    fn.name.toLowerCase().includes(options.name.toLowerCase())
  )

  if (matched.length === 0) {
    return { output: '', notes, errors: [`no function matching "${options.name}"`] }
  }

  return { notes, output: matched.map(renderExplain).join('\n\n' + '-'.repeat(70) + '\n\n') }
}

export async function runDiff(options: Common & { previous: string }): Promise<RunResult> {
  const { config, notes } = await configFor(options.root)
  const previous = JSON.parse(await readFile(options.previous, 'utf8')) as CountResult
  const { count } = await analyze(options.root, config)

  try {
    const diff = diffCounts(previous, count, {
      labels: { from: options.previous, to: 'current' },
    })
    return { notes, output: renderDiff(diff) }
  } catch (error) {
    if (error instanceof IncomparableRulesetsError) {
      return { output: '', notes, errors: [error.message] }
    }
    throw error
  }
}

export async function runCalibrate(options: Common & { samples: string }): Promise<RunResult> {
  const { config, notes } = await configFor(options.root)
  const samples = parseSamples(await readFile(options.samples, 'utf8'))
  const { count } = await analyze(options.root, config)
  const calibration = calibrate(count, samples)

  const { overall } = calibration
  const lines = [
    `samples: ${overall.samples} · manual ${overall.manualPoints} FP · ` +
      `automatic ${overall.automaticPoints} FP · deviation ${(overall.deviation * 100).toFixed(1)}%`,
    `exact matches: ${overall.exactMatches}/${overall.samples}`,
    '',
  ]

  for (const item of calibration.byType) {
    lines.push(
      `${item.type.padEnd(4)} n=${String(item.samples).padStart(3)} ` +
        `factor ${item.factor.toFixed(3)} · mean deviation ${item.meanAbsoluteDeviation} FP`
    )
  }

  return { notes: [...notes, ...calibration.warnings], output: lines.join('\n') }
}
