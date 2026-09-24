import { Project, SyntaxKind } from 'ts-morph'
import type { CallExpression, SourceFile } from 'ts-morph'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { discoverApp } from '../src/inventory/app_context.js'
import { collectDataStores } from '../src/inventory/sources/data_stores.js'
import { injectedFor } from '../src/inventory/graph/call_graph.js'
import type { CollectedDataStore } from '../src/inventory/sources/data_stores.js'
import type { ResolverContext } from '../src/inventory/resolvers/types.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const fixturePath = (...parts: string[]) => path.join(HERE, 'fixtures', ...parts)

/** raiz de uma fixture de aplicação completa, em tests/fixtures/apps/ */
export const appFixturePath = (name: string) => fixturePath('apps', name)

/**
 * Monta o contexto de uma fixture de padrão de código.
 *
 * Usa `discoverApp` e `collectDataStores` de verdade, nunca uma reimplementação
 * de teste. A versão anterior tinha um resolvedor de specifier próprio, e
 * helper que diverge do código é a pior espécie de teste verde: passa enquanto
 * o produto quebra.
 *
 * Fixtures não instalam, não bootam e não têm banco — são árvores de arquivos
 * que o ts-morph parseia.
 */
export async function loadFixture(name: string) {
  const root = fixturePath('patterns', name)
  const app = await discoverApp(root)

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false, strict: false },
  })
  project.addSourceFilesAtPaths(`${root}/**/*.ts`)

  const sourceFile = (absPath: string): SourceFile | null => project.getSourceFile(absPath) ?? null

  /** imports do arquivo: identificador local -> caminho absoluto */
  const importsOf = (file: SourceFile): Map<string, string> => {
    const map = new Map<string, string>()
    for (const declaration of file.getImportDeclarations()) {
      const target = app.resolveSpecifier(declaration.getModuleSpecifierValue())
      if (!target) continue

      const defaultImport = declaration.getDefaultImport()?.getText()
      if (defaultImport) map.set(defaultImport, target)
      for (const named of declaration.getNamedImports()) map.set(named.getName(), target)
    }
    return map
  }

  /**
   * INVARIANTE DE ORDEM: os DataStores são coletados antes de qualquer análise
   * de handler, porque `Model.create()` e `Service.create()` são
   * indistinguíveis pela forma.
   */
  const { stores } = await collectDataStores(app)
  const dataStoresBySymbol = new Map<string, CollectedDataStore>(
    stores.map((store) => [store.name, store])
  )

  return {
    root,
    app,
    project,
    stores,
    dataStoresBySymbol,
    sourceFile,

    /** o arquivo do controller da fixture */
    controller(): SourceFile {
      const file = project.getSourceFiles().find((f) => f.getFilePath().includes('/controllers/'))
      if (!file) throw new Error(`fixture "${name}" não tem controller`)
      return file
    },

    /** contexto de resolução para um arquivo da fixture */
    contextFor(file: SourceFile, depth = 0): ResolverContext {
      return {
        file,
        depth,
        imports: importsOf(file),
        // mesma função do pipeline: helper que reimplementa é teste enganoso
        injected: injectedFor(file.getClasses()[0], file, app),
        dataStoresBySymbol,
        resolveSpecifier: app.resolveSpecifier,
        sourceFile,
      }
    },

    /** todas as chamadas `algo(...)` dentro do corpo de um método */
    callsIn(file: SourceFile, methodName: string): CallExpression[] {
      for (const cls of file.getClasses()) {
        const method = cls.getMethod(methodName)
        if (method) return method.getDescendantsOfKind(SyntaxKind.CallExpression)
      }
      throw new Error(`método "${methodName}" não encontrado em ${file.getBaseName()}`)
    },
  }
}
