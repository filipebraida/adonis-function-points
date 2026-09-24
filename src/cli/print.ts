import type { RunResult } from './runners.js'

/**
 * One place that decides how a `RunResult` reaches a terminal.
 *
 * Shared so the two front-ends cannot drift in what they show — including the
 * failure path: a command that found nothing must exit non-zero in CI exactly
 * as it does under ace.
 */
export type Printer = {
  log: (message: string) => void
  error: (message: string) => void
  /**
   * Diagnostics about the run itself — which config was used, calibration
   * warnings. A separate channel because they must NOT land on stdout: `--json`
   * exists to be piped, and a note printed there makes the output unparseable.
   */
  note: (message: string) => void
}

export function printResult(result: RunResult, printer: Printer): number {
  for (const note of result.notes ?? []) printer.note(note)

  if (result.errors?.length) {
    for (const message of result.errors) printer.error(message)
    return 1
  }

  if (result.output) printer.log(result.output)
  return 0
}
