/**
 * Descobre a forma da aplicação analisada, em vez de assumir convenção.
 *
 * O levantamento em docs/research/adonisjs-variation.md mostrou que layout de
 * pastas, aliases de subpath e estilo de model variam entre aplicações, mas
 * que dois artefatos GERADOS existem em todas. É neles que a descoberta se
 * apoia — por isso este pacote quase não precisa de configuração.
 */
export type AppContext = {
  /** raiz da aplicação (onde está o adonisrc.ts) */
  root: string

  /**
   * Mapa `imports` do package.json, resolvido.
   *
   * Tem que ser LIDO, nunca deduzido: existem duas convenções incompatíveis em
   * uso — por tipo (`#models/*`) e por módulo (`#collect/*`).
   */
  subpathImports: Map<string, string>

  /** artefatos gerados encontrados; ausência é reportada, não contornada em silêncio */
  generated: {
    /** .adonisjs/client/registry/schema.d.ts — rotas, verbos, tipos de body/query */
    routeRegistry?: string
    /** .adonisjs/server/controllers.ts — nome -> arquivo do controller */
    controllersMap?: string
    /** database/schema.ts gerado das migrations — colunas canônicas */
    dataSchema?: string
  }

  /** layout detectado; serve para AGRUPAR relatório, nunca para encontrar arquivos */
  layout: 'flat' | 'module-per-domain' | 'unknown'

  /** resolve `#collect/models/invite` para caminho absoluto */
  resolveSpecifier(specifier: string): string | null

  /** módulo ao qual um arquivo pertence, para agrupar o relatório */
  moduleOf(absPath: string): string
}
