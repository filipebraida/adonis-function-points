import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CoverageTooLowError } from './pipeline.js'
import { ConfigLoadError } from './cli/load_config.js'
import { printResult } from './cli/print.js'
import { runCalibrate, runCount, runDiff, runExplain, runInventory } from './cli/runners.js'
import type { RunResult } from './cli/runners.js'

/**
 * Standalone entry point, for CI and for one-off runs with `npx`.
 *
 * It does NOT replace installing the package: a project that installs it keeps
 * the `node ace fp:*` commands. Both front-ends call the same runners, so they
 * cannot disagree about a number.
 *
 * Nothing is booted here either — the engine only ever reads files — which is
 * what makes a run possible with no `.env`, no database and no install in the
 * analysed project.
 */

const USAGE = `adonis-function-points — automated function point counting for AdonisJS

Usage
  adonis-function-points <command> [options]

Commands
  count                    count the unadjusted function points
  inventory                the raw facts: stores, routes, tracing coverage
  explain <name>           why one function was counted that way
  diff <previous.json>     additions / modifications / deletions, and billable FP
  calibrate <samples.csv>  correction factors against a manual count

Options
  --root <path>            application to analyse (default: the current directory)
  --out <path>             write the result as JSON to this path
  --json                   print JSON instead of a table
  --min-coverage <0..1>    fail below this tracing coverage
  -h, --help               this message
  -v, --version            package version
`

/**
 * The package's own version, for `--version`.
 *
 * Walks up from this module until it finds a package.json, so it works both
 * from source (`src/cli.ts`) and from the build (`build/src/cli.js`), which sit
 * at different depths.
 */
export function packageVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))

  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, 'package.json')
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string }
      if (parsed.version) return parsed.version
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return 'unknown'
}

/** minimal parser: a flag is `--name value` or `--name=value`, plus booleans */
export function parseArgv(argv: string[]) {
  const positional: string[] = []
  const flags = new Map<string, string | true>()

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('-')) {
      positional.push(token)
      continue
    }

    const name = token.replace(/^--?/, '')
    const [key, inline] = name.split('=')

    if (inline !== undefined) {
      flags.set(key, inline)
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith('-')) {
      flags.set(key, next)
      index++
    } else {
      flags.set(key, true)
    }
  }

  return { command: positional[0], positional: positional.slice(1), flags }
}

const numeric = (value: string | true | undefined) =>
  typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : undefined

const text = (value: string | true | undefined) => (typeof value === 'string' ? value : undefined)

export type Printer = {
  log: (message: string) => void
  error: (message: string) => void
}

const CONSOLE: Printer = {
  log: (message: string) => process.stdout.write(`${message}\n`),
  error: (message: string) => process.stderr.write(`${message}\n`),
}

export async function run(argv: string[], printer: Printer = CONSOLE): Promise<number> {
  const { command, positional, flags } = parseArgv(argv)

  if (flags.has('version') || flags.has('v')) {
    printer.log(packageVersion())
    return 0
  }

  if (!command || flags.has('help') || flags.has('h')) {
    printer.log(USAGE.trimEnd())
    return command ? 0 : 1
  }

  const root = path.resolve(text(flags.get('root')) ?? process.cwd())

  /**
   * Pointing at the wrong directory is the likeliest mistake in CI, and its
   * symptom would be a confident zero. Refusing beats counting nothing.
   */
  if (!existsSync(path.join(root, 'package.json'))) {
    printer.error(`no package.json in ${root}: this is not an application root`)
    return 1
  }

  const need = (what: string, value: string | undefined): string => {
    if (!value) throw new UsageError(`${command} needs ${what}`)
    return value
  }

  let result: RunResult

  switch (command) {
    case 'count':
      result = await runCount({
        root,
        out: text(flags.get('out')),
        json: flags.get('json') === true,
        minCoverage: numeric(flags.get('min-coverage')),
      })
      break

    case 'inventory':
      result = await runInventory({ root, out: text(flags.get('out')) })
      break

    case 'explain':
      result = await runExplain({ root, name: need('a function name', positional[0]) })
      break

    case 'diff':
      result = await runDiff({ root, previous: need('a saved count', positional[0]) })
      break

    case 'calibrate':
      result = await runCalibrate({ root, samples: need('a samples CSV', positional[0]) })
      break

    default:
      printer.error(`unknown command "${command}"`)
      printer.log(USAGE.trimEnd())
      return 1
  }

  return printResult(result, printer)
}

export class UsageError extends Error {}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    return await run(argv, CONSOLE)
  } catch (error) {
    /**
     * These three are not crashes — they are the package refusing to produce a
     * number it cannot stand behind. They deserve their message, not a stack.
     */
    if (
      error instanceof UsageError ||
      error instanceof ConfigLoadError ||
      error instanceof CoverageTooLowError
    ) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }

    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : error}\n`)
    return 1
  }
}
