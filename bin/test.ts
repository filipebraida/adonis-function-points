import { assert } from '@japa/assert'
import { configure, processCLIArgs, run } from '@japa/runner'

processCLIArgs(process.argv.splice(2))
configure({
  files: ['tests/**/*.spec.ts'],
  plugins: [assert()],

  /**
   * Japa's default is 2s, which is fine on a developer machine — the whole
   * suite runs in ~40s — and not fine on a CI runner, where each `analyze()`
   * takes 2 to 5 seconds: ts-morph builds a TypeScript program per fixture.
   *
   * The number is deliberately far above what a slow runner needs. A timeout
   * here would say nothing about the code, so it should only ever fire for a
   * genuine hang.
   */
  timeout: 60_000,
})

run()
