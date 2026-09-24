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

/** root of a full application fixture, under tests/fixtures/apps/ */
export const appFixturePath = (name: string) => fixturePath('apps', name)

/**
 * Builds the context for a code-pattern fixture.
 *
 * It uses the real `discoverApp` and `collectDataStores`, never a test-only
 * reimplementation. A helper that drifts from the code is the worst kind of
 * green test: it passes while the product breaks.
 *
 * Fixtures do not install, do not boot and have no database — they are file
 * trees that ts-morph parses.
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

  /** file imports: local identifier -> absolute path */
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
   * ORDERING INVARIANT: data stores are collected before any handler analysis,
   * because `Model.create()` and `Service.create()` are indistinguishable by
   * shape.
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

    /** the fixture's controller file */
    controller(): SourceFile {
      const file = project.getSourceFiles().find((f) => f.getFilePath().includes('/controllers/'))
      if (!file) throw new Error(`fixture "${name}" has no controller`)
      return file
    },

    /** resolution context for a file of the fixture */
    contextFor(file: SourceFile, depth = 0): ResolverContext {
      return {
        file,
        depth,
        imports: importsOf(file),
        // the same function the pipeline uses: a reimplementing helper misleads
        injected: injectedFor(file.getClasses()[0], file, app),
        dataStoresBySymbol,
        resolveSpecifier: app.resolveSpecifier,
        sourceFile,
      }
    },

    /** every `something(...)` call inside a method body */
    callsIn(file: SourceFile, methodName: string): CallExpression[] {
      for (const cls of file.getClasses()) {
        const method = cls.getMethod(methodName)
        if (method) return method.getDescendantsOfKind(SyntaxKind.CallExpression)
      }
      throw new Error(`method "${methodName}" not found in ${file.getBaseName()}`)
    },
  }
}
