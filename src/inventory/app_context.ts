import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Descobre a forma da aplicação analisada, em vez de assumir convenção.
 *
 * O levantamento em docs/research/adonisjs-variation.md mostrou que layout de
 * pastas, aliases de subpath e estilo de model variam entre aplicações, mas
 * que os artefatos GERADOS existem em todas. É neles que a descoberta se
 * apoia — por isso este pacote quase não precisa de configuração.
 */
export type AppLayout = 'flat' | 'module-per-domain' | 'unknown'

export type AppContext = {
  /** raiz da aplicação (onde está o adonisrc.ts) */
  root: string

  /**
   * Mapa `imports` do package.json, já normalizado.
   *
   * Tem que ser LIDO, nunca deduzido: existem duas convenções incompatíveis em
   * uso — por tipo (`#models/*`) e por módulo (`#catalog/*`).
   */
  subpathImports: Map<string, string>

  /**
   * Artefatos gerados encontrados.
   *
   * Ausência é um fato reportável, não algo a contornar em silêncio: sem
   * registry a contagem cai para o parser de rotas, que erra mais, e o
   * relatório tem que dizer isso.
   */
  generated: {
    routeRegistry?: string
    controllersMap?: string
    dataSchema?: string
  }

  /** detectado; usado para AGRUPAR relatório, nunca para encontrar arquivos */
  layout: AppLayout

  /** `#catalog/models/book` -> caminho absoluto, ou null */
  resolveSpecifier(specifier: string): string | null

  /** módulo ao qual um arquivo pertence, para agrupar o relatório */
  moduleOf(absPath: string): string
}

/** pastas que nomeiam um TIPO de artefato, em qualquer dos dois layouts */
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
  const abs = path.resolve(root)
  const subpathImports = await readSubpathImports(abs)
  const layout = await detectLayout(abs)

  const resolveSpecifier = (specifier: string): string | null =>
    resolveWithImports(abs, subpathImports, specifier)

  const generated = {
    routeRegistry: await firstExisting(abs, ['.adonisjs/client/registry/schema.d.ts']),
    controllersMap: await firstExisting(abs, ['.adonisjs/server/controllers.ts']),
    dataSchema: await findDataSchema(abs, resolveSpecifier),
  }

  return {
    root: abs,
    subpathImports,
    generated,
    layout,
    resolveSpecifier,
    moduleOf: (absPath) => moduleOf(abs, layout, absPath),
  }
}

// ---------------------------------------------------------------------------
// aliases de subpath
// ---------------------------------------------------------------------------
async function readSubpathImports(root: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const raw = await readJson(path.join(root, 'package.json'))
  const imports = (raw?.imports ?? {}) as Record<string, unknown>

  for (const [key, value] of Object.entries(imports)) {
    const target = typeof value === 'string' ? value : pickDefault(value)
    if (target) map.set(key, target)
  }
  return map
}

/** entradas condicionais: { "import": "./x.js", "default": "./x.js" } */
function pickDefault(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  for (const key of ['import', 'default', 'node', 'require']) {
    if (typeof obj[key] === 'string') return obj[key] as string
  }
  return null
}

/**
 * Resolve um specifier contra o mapa `imports`.
 *
 * O mapa aponta para `.js` (é o que o Node executa), mas nós analisamos código
 * fonte — daí a tradução para `.ts`. Entradas mais específicas ganham das mais
 * genéricas: `#core/*` tem que vencer `#app/*` quando as duas casam.
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
  return path.join(root, rel)
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------
/**
 * Decide pelo peso das evidências, não pela primeira pasta que aparece.
 *
 * `app/models` direto é evidência de layout plano; `app/catalog/models` é
 * evidência de módulo por domínio. Uma app pode ter as duas coisas (um
 * `app/middleware` solto num projeto modular), então conta-se os dois lados.
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

function moduleOf(root: string, layout: AppLayout, absPath: string): string {
  const rel = path.relative(root, absPath)
  const segments = rel.split(path.sep)
  if (segments[0] !== 'app') return segments[0] ?? 'app'
  if (layout === 'module-per-domain') return segments[1] ?? 'app'
  return 'app'
}

// ---------------------------------------------------------------------------
// schema de dados gerado
// ---------------------------------------------------------------------------
/**
 * Acha `database/schema.ts` pelo que ele É, não por onde está.
 *
 * Nas apps levantadas ele aparece em `database/schema.ts` e em
 * `app/core/database/schema.ts`. Tentamos o alias `#database/schema` primeiro,
 * depois os caminhos conhecidos, e por fim uma varredura curta procurando o
 * cabeçalho de geração — porque o caminho é o detalhe menos confiável.
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
// utilidades
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

async function firstExisting(root: string, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    const full = path.join(root, candidate)
    try {
      await fs.access(full)
      return full
    } catch {
      /* segue */
    }
  }
  return undefined
}
