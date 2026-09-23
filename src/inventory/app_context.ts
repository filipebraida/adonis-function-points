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

  /**
   * Arquivos que registram rotas, a partir dos `preloads` do adonisrc,
   * seguindo os `import` estáticos que eles alcançam.
   *
   * A lista de preloads é a fonte autoritativa — não convenção de caminho.
   * Quatro topologias foram encontradas: arquivo único, um por módulo, um
   * diretório, e um hub que só reexporta.
   */
  routeFiles: string[]

  /**
   * Diretórios a varrer, derivados dos alvos dos aliases.
   *
   * Não é `app/`: numa app levantada, 100% da escrita mora em `src/`.
   * Raízes aninhadas em outras são colapsadas.
   */
  scanRoots: string[]

  /** versões e ORM — escolhem a estratégia e vão para o relatório */
  framework: FrameworkInfo

  /** `#catalog/models/book` -> caminho absoluto, ou null */
  resolveSpecifier(specifier: string): string | null

  /** módulo ao qual um arquivo pertence, para agrupar o relatório */
  moduleOf(absPath: string): string
}

export type FrameworkInfo = {
  /** major do @adonisjs/core, quando declarado */
  core?: number
  /** major do @adonisjs/lucid, quando declarado */
  lucid?: number
  orm: 'lucid' | 'kysely' | 'unknown'
  /** Tuyau dá DETs de entrada tipados; opcional */
  tuyau: boolean
  /**
   * Dentro do escopo do v1 (core 7 + Lucid 22).
   *
   * Fora dele o pacote reporta em vez de contar — contar errado em silêncio é
   * a pior falha possível num número que vira fatura.
   */
  supported: boolean
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
// raízes de varredura
// ---------------------------------------------------------------------------
/**
 * Deriva os diretórios a varrer dos ALVOS dos aliases, e colapsa os aninhados.
 *
 * Manter `app/admin` ao lado de `app` faria cada arquivo ser varrido duas vezes
 * e, pior, mudaria o módulo calculado: `app/admin/catalog/...` viraria
 * "catalog" em vez de "admin/catalog".
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

  // remove o que estiver dentro de outra raiz
  const collapsed = existing.filter(
    (dir) => !existing.some((other) => other !== dir && isInside(dir, other))
  )

  return [...new Set(collapsed)].sort().map((dir) => path.join(root, dir))
}

const isInside = (child: string, parent: string) => child.startsWith(parent + '/')

/**
 * Raízes que um alias alcança mas que NÃO são código de aplicação.
 *
 * Não é preciosismo: numa app real há `.insertInto()` em `tests/factories/`.
 * Varrer isso contaria escrita de teste como função da aplicação — e o número
 * vai para uma fatura.
 *
 * É decisão de fronteira, então o default é conservador e a lista fica
 * sobrescrevível pela configuração (`boundary`), como manda a arquitetura.
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
// arquivos de rota
// ---------------------------------------------------------------------------
const ROUTE_CALL = /\brouter\s*\.\s*(get|post|put|patch|delete|any|resource|on|group)\s*\(/

/**
 * Parte dos `preloads` do adonisrc e segue os `import` estáticos.
 *
 * Um preload pode ser um hub que não define rota nenhuma, só reexporta — foi o
 * que a app do core team fez. Seguir só o preload devolveria um arquivo vazio.
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

/** imports estáticos, incluindo `import '#x'` sem binding */
function staticImportsOf(source: string): string[] {
  return [...source.matchAll(/\bimport\s+(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]/g)].map((m) => m[1])
}

// ---------------------------------------------------------------------------
// aliases de subpath
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

/** contêineres de topo que não nomeiam domínio — só abrigam código */
const CODE_CONTAINERS = new Set(['app', 'src'])

/**
 * Módulo = segmentos entre o contêiner de topo e o primeiro segmento que nomeia
 * um TIPO de artefato.
 *
 *   app/models/book.ts                 -> 'app'           (nada antes do tipo)
 *   app/catalog/models/book.ts         -> 'catalog'
 *   app/admin/catalog/models/book.ts   -> 'admin/catalog'  (aninhado)
 *   src/catalog/actions/create_book.ts -> 'catalog'         (fora de app/)
 *
 * Deliberadamente NÃO usa `scanRoots`: em layout plano não existe alias
 * `#app/*`, e as raízes acabam sendo as próprias pastas de tipo
 * (`app/models`), o que faria o módulo virar "models".
 *
 * Serve só para agrupar relatório. Nunca para encontrar arquivo.
 */
function moduleOf(root: string, absPath: string): string {
  const segments = path.relative(root, absPath).split(path.sep).slice(0, -1)
  const body = CODE_CONTAINERS.has(segments[0]) ? segments.slice(1) : segments

  const kindAt = body.findIndex((segment) => ARTIFACT_KINDS.has(segment))
  const moduleSegments = kindAt === -1 ? body : body.slice(0, kindAt)

  return moduleSegments.length > 0 ? moduleSegments.join('/') : 'app'
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
      /* segue */
    }
  }
  return undefined
}
