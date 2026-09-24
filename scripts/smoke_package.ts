import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Installs the packed tarball into a throwaway application and uses it.
 *
 * This exists because 210 green tests once coexisted with a package that could
 * not be imported at all: tsdown emitted `.mjs` while every `exports` entry in
 * package.json pointed at `.js`, so the published artefact resolved nothing.
 * The whole suite runs from source through ts-exec, and never once loaded
 * `build/`, which is the only thing a user ever gets.
 *
 * So this checks the two things source-level tests structurally cannot:
 *
 *   1. every published entry point resolves from a real install;
 *   2. a `config/function_points.ts` that imports the package — exactly what
 *      `node ace configure` writes — loads and reaches the count.
 *
 * The second matters more than it looks: configuration that fails to load is a
 * hard error by design, so a broken package entry would not degrade, it would
 * stop every configured application from counting at all.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const run = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const checks: string[] = []
const pass = (what: string) => {
  checks.push(what)
  process.stdout.write(`  ok  ${what}\n`)
}

function fail(what: string, detail: unknown): never {
  process.stderr.write(
    `\n  FAILED  ${what}\n\n${detail instanceof Error ? detail.message : detail}\n`
  )
  process.exit(1)
}

if (!existsSync(path.join(ROOT, 'build', 'index.js'))) {
  fail('build present', new Error('build/index.js missing — run `npm run compile` first'))
}

const workspace = mkdtempSync(path.join(tmpdir(), 'fp-smoke-'))

try {
  process.stdout.write('packing…\n')
  run('npm', ['pack', '--pack-destination', workspace], ROOT)
  const tarball = readdirSync(workspace).find((entry) => entry.endsWith('.tgz'))
  if (!tarball) fail('npm pack produced a tarball', new Error(readdirSync(workspace).join(', ')))
  pass(`packed ${tarball}`)

  // a real application, installing the package the way a user would
  const app = path.join(workspace, 'app')
  cpSync(path.join(ROOT, 'tests', 'fixtures', 'apps', 'minimal_flat'), app, { recursive: true })
  /**
   * Keep the fixture's own `imports` map: it is how `#models/book` resolves,
   * and without it the app discovers nothing. An earlier version of this script
   * overwrote the whole file, so every count here was 0 and the assertions
   * below passed vacuously.
   */
  const appManifest = JSON.parse(readFileSync(path.join(app, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >
  writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({ ...appManifest, name: 'smoke-app', private: true }, null, 2)
  )

  process.stdout.write('installing the tarball…\n')
  run('npm', ['install', '--no-audit', '--no-fund', path.join(workspace, tarball!)], app)
  pass('tarball installs')

  // 1. every published entry point has to resolve from the install
  const entries = [
    '@filipebraida/adonis-function-points',
    '@filipebraida/adonis-function-points/types',
    '@filipebraida/adonis-function-points/resolvers',
  ]
  for (const entry of entries) {
    try {
      run('node', ['--input-type=module', '-e', `await import(${JSON.stringify(entry)})`], app)
      pass(`resolves ${entry}`)
    } catch (error) {
      fail(`resolves ${entry}`, error)
    }
  }

  try {
    const out = run(
      'node',
      [
        '--input-type=module',
        '-e',
        `const m = await import('@filipebraida/adonis-function-points')
         if (typeof m.defineConfig !== 'function') throw new Error('defineConfig missing')
         if (!Array.isArray(m.BUILTIN_CALL_RESOLVERS)) throw new Error('resolvers missing')
         process.stdout.write('ok')`,
      ],
      app
    )
    if (out.trim() !== 'ok') throw new Error(out)
    pass('the package exports what index.ts declares')
  } catch (error) {
    fail('the package exports what index.ts declares', error)
  }

  // 2. the config `node ace configure` writes, loaded through the installed package
  writeFileSync(
    path.join(app, 'config', 'function_points.ts'),
    `import { defineConfig } from '@filipebraida/adonis-function-points'\n\n` +
      `export default defineConfig({ boundary: { infrastructure: ['Book'] } })\n`
  )

  const bin = path.join(app, 'node_modules', '.bin', 'adonis-function-points')
  if (!existsSync(bin)) fail('the bin is linked on install', new Error(`${bin} not found`))
  pass('the bin is linked on install')

  const counted = spawnSync(bin, ['count', '--root', app], { cwd: app, encoding: 'utf8' })
  const output = counted.stdout ?? ''
  const diagnostics = counted.stderr ?? ''

  if (counted.status !== 0 || !output.includes('Unadjusted count:')) {
    fail('counts through the installed binary', new Error(output + diagnostics))
  }
  pass('counts through the installed binary')

  /**
   * The note naming the configuration belongs on stderr, not stdout: `--json`
   * exists to be piped, and a note printed there makes the output unparseable.
   */
  if (!/config:.*function_points\.ts/.test(diagnostics)) {
    fail('honours a config that imports the package', new Error(diagnostics || '(no stderr)'))
  }
  pass('honours a config that imports the package')

  if (/^Book\s/m.test(output)) {
    fail('the config actually changed the count', new Error('Book was excluded but still counted'))
  }
  pass('the config actually changed the count')

  /**
   * Without this, every assertion above passes on an empty count: the binary
   * runs, prints a total of 0, and `Book` is absent because nothing was found.
   */
  const total = Number(output.match(/Unadjusted count:\s*(\d+)/)?.[1] ?? 0)
  if (total <= 0) fail('the count is not empty', new Error(output))
  pass(`the count is not empty (${total} FP)`)

  // `--json` is the CI contract: stdout has to parse, with notes kept off it
  const asJson = spawnSync(bin, ['count', '--root', app, '--json'], { cwd: app, encoding: 'utf8' })
  try {
    const parsed = JSON.parse(asJson.stdout ?? '') as { totals?: { unadjusted?: number } }
    if (typeof parsed.totals?.unadjusted !== 'number') throw new Error('no totals in the JSON')
  } catch (error) {
    fail('--json writes parseable JSON on stdout', error)
  }
  pass('--json writes parseable JSON on stdout')

  process.stdout.write(`\n${checks.length} checks passed against the packed tarball\n`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
