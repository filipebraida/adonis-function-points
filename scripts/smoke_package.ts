import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({ name: 'smoke-app', type: 'module', private: true }, null, 2)
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

  let output: string
  try {
    output = run(bin, ['count', '--root', app], app)
  } catch (error) {
    fail('counts through the installed binary', error)
  }

  if (!output.includes('Unadjusted count:')) {
    fail('counts through the installed binary', new Error(output))
  }
  pass('counts through the installed binary')

  if (!/config:.*function_points\.ts/.test(output)) {
    fail('honours a config that imports the package', new Error(output))
  }
  pass('honours a config that imports the package')

  if (/^Book\s/m.test(output)) {
    fail('the config actually changed the count', new Error('Book was excluded but still counted'))
  }
  pass('the config actually changed the count')

  process.stdout.write(`\n${checks.length} checks passed against the packed tarball\n`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
