import { Project, SyntaxKind } from 'ts-morph'
import type { CallExpression, SourceFile } from 'ts-morph'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import type { ResolverContext } from '../src/inventory/resolvers/types.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const fixturePath = (...parts: string[]) => path.join(HERE, 'fixtures', ...parts)

/** raiz de uma fixture de aplicação completa, em tests/fixtures/apps/ */
export const appFixturePath = (name: string) => fixturePath('apps', name)

/**
 * Monta um projeto ts-morph a partir de uma fixture.
 *
 * Fixtures não precisam instalar, bootar nem ter banco — são só árvores de
 * arquivos que o ts-morph parseia. É o que torna barato ter um caso por padrão
 * de código em vez de um playground só.
 */
export function loadFixture(name: string) {
  const root = fixturePath('patterns', name)

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false, strict: false },
  })
  project.addSourceFilesAtPaths(`${root}/**/*.ts`)

  /** `#collect/models/invite` -> caminho absoluto dentro da fixture */
  const resolveSpecifier = (specifier: string): string | null => {
    if (!specifier.startsWith('#')) return null
    const withoutHash = specifier.replace(/^#/, '')
    return path.join(root, 'app', withoutHash + '.ts')
  }

  const sourceFile = (absPath: string): SourceFile | null => project.getSourceFile(absPath) ?? null

  /** imports do arquivo: identificador local -> caminho absoluto */
  const importsOf = (file: SourceFile): Map<string, string> => {
    const map = new Map<string, string>()
    for (const decl of file.getImportDeclarations()) {
      const target = resolveSpecifier(decl.getModuleSpecifierValue())
      if (!target) continue
      const def = decl.getDefaultImport()?.getText()
      if (def) map.set(def, target)
      for (const named of decl.getNamedImports()) map.set(named.getName(), target)
    }
    return map
  }

  /**
   * DataStores da fixture. O pipeline real coleta isto antes de analisar
   * qualquer handler — ver a invariante de ordem em ResolverContext.
   */
  const dataStoresBySymbol = new Map<string, any>()
  for (const file of project.getSourceFiles()) {
    if (!file.getFilePath().includes('/models/')) continue
    const cls = file.getClasses().find((c) => c.isDefaultExport()) ?? file.getClasses()[0]
    if (cls?.getName()) dataStoresBySymbol.set(cls.getName()!, { id: cls.getName()! })
  }

  return {
    root,
    project,
    dataStoresBySymbol,
    resolveSpecifier,
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
        dataStoresBySymbol,
        resolveSpecifier,
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
