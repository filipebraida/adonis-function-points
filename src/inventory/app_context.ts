import fs from 'node:fs/promises'
import path from 'node:path'

import { toPosix } from './paths.js'

/**
 * Discovers the shape of the analysed application instead of assuming a
 * convention.
 *
 * Folder layout, subpath aliases and model style all vary between AdonisJS
 * applications. What does not vary is that the facts are discoverable — which
 * is why this package needs almost no configuration.
 */
export type AppLayout = 'flat' | 'module-per-domain' | 'unknown'

export type AppContext = {
  /** application root (where adonisrc.ts lives) */
  root: string

  /**
   * The package.json `imports` map, normalised.
   *
   * It must be READ, never inferred: two incompatible conventions are in use —
   * by artefact type (`#models/*`) and by domain module (`#catalog/*`).
   */
  subpathImports: Map<string, string>

  /**
   * Generated artefacts found.
   *
   * Absence is a reportable fact, not something to work around silently:
   * without the registry the count falls back to the route parser, which is
   * less precise, and the report must say so.
   */
  generated: {
    routeRegistry?: string
    controllersMap?: string
    dataSchema?: string
  }

  /** detected; used to GROUP the report, never to find files */
  layout: AppLayout

  /**
   * Files that register routes, starting from the adonisrc `preloads` and
   * following the static imports they reach.
   *
   * The preload list is the authoritative source, not a path convention. Four
   * topologies occur in practice: a single file, one per module, a directory,
   * and a hub that only re-exports.
   */
  routeFiles: string[]

  /**
   * Directories to scan, derived from the alias targets.
   *
   * Not simply `app/`: applications exist where all writes live under `src/`.
   * Roots nested inside other roots are collapsed.
   */
  scanRoots: string[]

  /** versions and ORM — they pick the strategy and go into the report */
  framework: FrameworkInfo

  /** `#catalog/models/book` -> absolute path, or null */
  resolveSpecifier(specifier: string): string | null

  /** module a file belongs to, for grouping the report */
  moduleOf(absPath: string): string
}

export type FrameworkInfo = {
  /** major of @adonisjs/core, when declared */
  core?: number
  /** major of @adonisjs/lucid, when declared */
  lucid?: number
  orm: 'lucid' | 'kysely' | 'unknown'
  /** Tuyau provides typed input DETs; optional */
  tuyau: boolean
  /**
   * Within the v1 scope (core 7 + Lucid 22).
   *
   * Outside it the package reports instead of counting — counting wrong in
   * silence is the worst possible failure for a number that becomes an invoice.
   */
  supported: boolean
}

/** folders naming an artefact TYPE, in either layout */
const ARTIFACT_KINDS = new Set([
  'models',
  'controllers',
  'services',
  'actions',
  'queries',
  'validators',
  'transformers',
  'jobs',
  'policies',
  'middleware',
  'middlewares',
  'listeners',
  'events',
  'exceptions',
  'mails',
  'enums',
  'abilities',
  'notifications',
  'dtos',
  'resources',
  'mixins',
  'hooks',
  'providers',
  'commands',
])

const GENERATED_MARKER = 'automatically generated'

export async function discoverApp(root: string): Promise<AppContext> {
  const abs = toPosix(path.resolve(root))
  const pkg = await readJson(path.join(abs, 'package.json'))
  const subpathImports = readSubpathImports(pkg)
  const layout = await detectLayout(abs)

  const resolveSpecifier = (specifier: string): string | null =>
    resolveWithImports(abs, subpathImports, specifier)

  const generated = {
    routeRegistry: await firstExisting(abs, ['.adonisjs/client/registry/schema.d.ts']),
    controllersMap: await firstExisting(abs, ['.adonisjs/server/controllers.ts']),
    dataSchema: await findDataSchema(abs, resolveSpecifier),
  }

  const scanRoots = await collectScanRoots(abs, subpathImports)
  const routeFiles = await collectRouteFiles(abs, resolveSpecifier)

  return {
    root: abs,
    subpathImports,
    generated,
    layout,
    routeFiles,
    scanRoots,
    framework: readFramework(pkg),
    resolveSpecifier,
    moduleOf: (absPath) => moduleOf(abs, absPath),
  }
}

// ---------------------------------------------------------------------------
// framework
// ---------------------------------------------------------------------------
const majorOf = (range?: string): number | undefined => {
  const m = range?.match(/(\d+)\./)
  return m ? Number(m[1]) : undefined
}

function readFramework(pkg: Record<string, unknown> | null): FrameworkInfo {
  const deps = {
    ...((pkg?.dependencies as Record<string, string>) ?? {}),
    ...((pkg?.devDependencies as Record<string, string>) ?? {}),
  }

  const core = majorOf(deps['@adonisjs/core'])
  const lucid = majorOf(deps['@adonisjs/lucid'])
  const orm: FrameworkInfo['orm'] = lucid ? 'lucid' : deps['kysely'] ? 'kysely' : 'unknown'

  return {
    core,
    lucid,
    orm,
    tuyau: Boolean(deps['@tuyau/core']),
    supported: core === 7 && lucid !== undefined && lucid >= 22,
  }
}

// ---------------------------------------------------------------------------
// scan roots
// ---------------------------------------------------------------------------
/**
 * Derives the directories to scan from the alias TARGETS, collapsing nested
 * ones.
 *
 * Keeping `app/admin` alongside `app` would scan each file twice and, worse,
 * change the computed module: `app/admin/catalog/...` would become "catalog"
 * instead of "admin/catalog".
 */
async function collectScanRoots(root: string, imports: Map<string, string>): Promise<string[]> {
  const candidates = new Set<string>()

  for (const target of imports.values()) {
    const dir = target.replace(/^\.\//, '').split('*')[0].replace(/\/$/, '')
    if (!dir || dir.startsWith('.')) continue
    if (NON_APPLICATION_ROOTS.some((pattern) => pattern.test(dir))) continue
    candidates.add(dir)
  }

  const existing: string[] = []
  for (const dir of candidates) {
    const full = path.join(root, dir)
    if (await isDirectory(full)) existing.push(dir)
  }

  // drop anything nested inside another root
  const collapsed = existing.filter(
    (dir) => !existing.some((other) => other !== dir && isInside(dir, other))
  )

  return [...new Set(collapsed)].sort().map((dir) => path.join(root, dir))
}

const isInside = (child: string, parent: string) => child.startsWith(parent + '/')

/**
 * Roots an alias reaches that are NOT application code.
 *
 * Not pedantry: test factories routinely contain real persistence calls.
 * Scanning them would count test writes as application functions — and the
 * number goes into an invoice.
 */
const NON_APPLICATION_ROOTS = [
  /^tests?(\/|$)/,
  /^config(\/|$)/,
  /^database(\/|$)/,
  /^public(\/|$)/,
  /^resources(\/|$)/,
  /^inertia(\/|$)/,
  /^bin(\/|$)/,
  /^build(\/|$)/,
  /^node_modules(\/|$)/,
]

// ---------------------------------------------------------------------------
// route files
// ---------------------------------------------------------------------------
const ROUTE_CALL = /\brouter\s*\.\s*(get|post|put|patch|delete|any|resource|on|group)\s*\(/

/**
 * Starts from the adonisrc `preloads` and follows static imports.
 *
 * A preload may be a hub that defines no route at all and only re-exports.
 * Stopping at the preload would return an empty file.
 */
async function collectRouteFiles(
  root: string,
  resolveSpecifier: (s: string) => string | null
): Promise<string[]> {
  const adonisrc = await readFileOrNull(path.join(root, 'adonisrc.ts'))
  if (!adonisrc) return []

  const found: string[] = []
  const seen = new Set<string>()

  const visit = async (file: string, depth: number) => {
    if (seen.has(file) || depth < 0) return
    seen.add(file)

    const source = await readFileOrNull(file)
    if (source === null) return

    if (ROUTE_CALL.test(source)) found.push(file)

    for (const spec of staticImportsOf(source)) {
      const target = resolveSpecifier(spec)
      if (target) await visit(target, depth - 1)
    }
  }

  for (const spec of preloadSpecifiersOf(adonisrc)) {
    const target = resolveSpecifier(spec)
    if (target) await visit(target, 3)
  }

  return found
}

/** `preloads: [() => import('#start/routes'), ...]` */
function preloadSpecifiersOf(adonisrc: string): string[] {
  const block = adonisrc.match(/preloads\s*:\s*\[([\s\S]*?)\]/)
  if (!block) return []
  return [...block[1].matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
}

/** static imports, including `import '#x'` with no binding */
function staticImportsOf(source: string): string[] {
  return [...source.matchAll(/\bimport\s+(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]/g)].map((m) => m[1])
}

// ---------------------------------------------------------------------------
// subpath aliases
// ---------------------------------------------------------------------------
function readSubpathImports(pkg: Record<string, unknown> | null): Map<string, string> {
  const map = new Map<string, string>()
  const imports = (pkg?.imports ?? {}) as Record<string, unknown>

  for (const [key, value] of Object.entries(imports)) {
    const target = typeof value === 'string' ? value : pickDefault(value)
    if (target) map.set(key, target)
  }
  return map
}

/** conditional entries: { "import": "./x.js", "default": "./x.js" } */
function pickDefault(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  for (const key of ['import', 'default', 'node', 'require']) {
    if (typeof obj[key] === 'string') return obj[key] as string
  }
  return null
}

/**
 * Resolves a specifier against the `imports` map.
 *
 * The map points at `.js` (what Node executes) while we analyse source, hence
 * the translation to `.ts`. More specific entries win over generic ones:
 * `#app/legacy/*` must beat `#app/*` when both match.
 */
function resolveWithImports(
  root: string,
  imports: Map<string, string>,
  specifier: string
): string | null {
  if (!specifier.startsWith('#')) return null

  let best: { target: string; specificity: number } | null = null

  for (const [pattern, target] of imports) {
    const star = pattern.indexOf('*')

    if (star === -1) {
      if (pattern === specifier) return toSource(root, target)
      continue
    }

    const prefix = pattern.slice(0, star)
    const suffix = pattern.slice(star + 1)
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue

    const middle = specifier.slice(prefix.length, specifier.length - suffix.length)
    const resolved = target.replace('*', middle)
    if (!best || prefix.length > best.specificity) {
      best = { target: resolved, specificity: prefix.length }
    }
  }

  return best ? toSource(root, best.target) : null
}

function toSource(root: string, target: string): string {
  const rel = target.replace(/^\.\//, '').replace(/\.js$/, '.ts')
  return toPosix(path.join(root, rel))
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------
/**
 * Decides by weight of evidence, not by the first folder encountered.
 *
 * `app/models` directly is evidence of a flat layout; `app/catalog/models` is
 * evidence of module-per-domain. An application can show both (a loose
 * `app/middleware` in a modular project), so both sides are counted.
 */
async function detectLayout(root: string): Promise<AppLayout> {
  const appDir = path.join(root, 'app')
  const top = await listDirs(appDir)
  if (top.length === 0) return 'unknown'

  let flat = 0
  let modular = 0

  for (const entry of top) {
    if (ARTIFACT_KINDS.has(entry)) {
      flat++
      continue
    }
    const nested = await listDirs(path.join(appDir, entry))
    if (nested.some((child) => ARTIFACT_KINDS.has(child))) modular++
  }

  if (modular > flat) return 'module-per-domain'
  if (flat > 0) return 'flat'
  return 'unknown'
}

/** top-level containers that name no domain — they only hold code */
const CODE_CONTAINERS = new Set(['app', 'src'])

/**
 * Module = the segments between the top-level container and the first segment
 * naming an artefact TYPE.
 *
 *   app/models/book.ts                 -> 'app'            (nothing before the type)
 *   app/catalog/models/book.ts         -> 'catalog'
 *   app/admin/catalog/models/book.ts   -> 'admin/catalog'  (nested)
 *   src/catalog/actions/create_book.ts -> 'catalog'        (outside app/)
 *
 * Deliberately does NOT use `scanRoots`: in a flat layout there is no `#app/*`
 * alias, so the roots end up being the artefact-type folders themselves
 * (`app/models`), which would make the module "models".
 *
 * Used only to group the report. Never to find a file.
 */
function moduleOf(root: string, absPath: string): string {
  const segments = path.relative(root, absPath).split(path.sep).slice(0, -1)
  const body = CODE_CONTAINERS.has(segments[0]) ? segments.slice(1) : segments

  const kindAt = body.findIndex((segment) => ARTIFACT_KINDS.has(segment))
  const moduleSegments = kindAt === -1 ? body : body.slice(0, kindAt)

  return moduleSegments.length > 0 ? moduleSegments.join('/') : 'app'
}

// ---------------------------------------------------------------------------
// generated data schema
// ---------------------------------------------------------------------------
/**
 * Finds `database/schema.ts` by what it IS, not by where it sits.
 *
 * It appears as `database/schema.ts` and as `app/core/database/schema.ts`
 * depending on the project. The `#database/schema` alias is tried first, then
 * the known paths, then a shallow scan for the generation header — because the
 * path is the least reliable signal.
 */
async function findDataSchema(
  root: string,
  resolveSpecifier: (s: string) => string | null
): Promise<string | undefined> {
  const viaAlias = resolveSpecifier('#database/schema')
  if (viaAlias && (await isGeneratedSchema(viaAlias))) return viaAlias

  const known = ['database/schema.ts', 'app/core/database/schema.ts', 'app/database/schema.ts']
  for (const candidate of known) {
    const full = path.join(root, candidate)
    if (await isGeneratedSchema(full)) return full
  }

  return scanForSchema(root, 4)
}

async function isGeneratedSchema(file: string): Promise<boolean> {
  try {
    const content = await fs.readFile(file, 'utf8')
    const head = content.slice(0, 2000)
    return head.includes(GENERATED_MARKER) && /class\s+\w+Schema\b/.test(head)
  } catch {
    return false
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'coverage', 'tmp'])

async function scanForSchema(dir: string, depth: number): Promise<string | undefined> {
  if (depth < 0) return undefined
  const entries = await readEntries(dir)

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === 'schema.ts') {
      if (await isGeneratedSchema(full)) return full
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue
    const found = await scanForSchema(path.join(dir, entry.name), depth - 1)
    if (found) return found
  }
  return undefined
}

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------
async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function readEntries(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function listDirs(dir: string): Promise<string[]> {
  const entries = await readEntries(dir)
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dir)
    return stats.isDirectory()
  } catch {
    return false
  }
}

async function readFileOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function firstExisting(root: string, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    const full = path.join(root, candidate)
    try {
      await fs.access(full)
      return full
    } catch {
      /* keep looking */
    }
  }
  return undefined
}
