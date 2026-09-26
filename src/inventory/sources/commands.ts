import { Node, Project } from 'ts-morph'
import type { ClassDeclaration, SourceFile } from 'ts-morph'

import type { AppContext } from '../app_context.js'
import { toPosix } from '../paths.js'
import type { CollectedEntryPoint } from './routes_ast.js'

/**
 * Ace commands as entry points — counting-decisions §5, plan 0.7 §C.
 *
 * IFPUG counts batch processes an operator starts. `node ace articles:import`
 * reads a feed and writes news: an EI exactly like a `POST`, and until this the
 * collector emitted only `kind: 'http'`, although the type had `command` and §5
 * had decided its identity since 0.1.0.
 *
 * AdonisJS scans `./commands` for the application's own commands; so does this.
 * A command is a class extending `BaseCommand` from `@adonisjs/core/ace` with a
 * literal `static commandName`; its body is `run()`, followed by the same
 * strategies as any handler. What it reaches decides whether it is a transaction
 * at all — a scaffolder that writes files reaches no store and falls out, as a
 * static route does.
 */

const ACE_MODULE = '@adonisjs/core/ace'
const BASE_COMMAND = 'BaseCommand'
/** a generator of test data, by the package everyone uses for it */
const FAKER = /^@faker-js\/faker/

export const GENERATES_DATA_HINT =
  'imports @faker-js/faker: generates data, probably a development tool'

export function collectCommands(app: AppContext): CollectedEntryPoint[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  })
  project.addSourceFilesAtPaths(`${toPosix(app.root)}/commands/**/*.ts`)

  const entryPoints: CollectedEntryPoint[] = []

  for (const file of project.getSourceFiles()) {
    if (/\.(spec|test)\.ts$/.test(file.getBaseName())) continue
    const baseCommand = baseCommandNameIn(file)
    if (!baseCommand) continue

    for (const cls of file.getClasses()) {
      if (cls.getExtends()?.getExpression().getText() !== baseCommand) continue
      const name = commandNameOf(cls)
      if (!name) continue

      const filePath = file.getFilePath()
      const hints = importsFaker(file) ? [GENERATES_DATA_HINT] : []

      entryPoints.push({
        id: `ace ${name}`,
        kind: 'command',
        module: app.moduleOf(filePath),
        trigger: 'ace',
        signature: name,
        name,
        handler: { file: filePath, member: 'run' },
        // §5: the command name; rendered the way HTTP renders `<verb> <pattern>`
        identity: `ace ${name}`,
        provenance: { file: filePath, line: cls.getStartLineNumber(), by: 'ace-commands' },
        ...(hints.length ? { hints } : {}),
      })
    }
  }

  return entryPoints.sort((a, b) => a.identity.localeCompare(b.identity))
}

/** the local name `BaseCommand` was imported under from `@adonisjs/core/ace`, if it was */
function baseCommandNameIn(file: SourceFile): string | null {
  for (const declaration of file.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== ACE_MODULE) continue
    const named = declaration.getNamedImports().find((n) => n.getName() === BASE_COMMAND)
    if (named) return named.getAliasNode()?.getText() ?? BASE_COMMAND
  }
  return null
}

/** `static commandName = 'articles:import'` — a literal; a computed name is nobody's identity */
function commandNameOf(cls: ClassDeclaration): string | null {
  const property = cls.getStaticProperty('commandName')
  if (!property || !Node.isPropertyDeclaration(property)) return null
  const initializer = property.getInitializer()
  if (!initializer) return null
  if (Node.isStringLiteral(initializer) || Node.isNoSubstitutionTemplateLiteral(initializer))
    return initializer.getLiteralValue()
  return null
}

function importsFaker(file: SourceFile): boolean {
  return file.getImportDeclarations().some((d) => FAKER.test(d.getModuleSpecifierValue()))
}

/** the ace decorators that declare what the operator types: `@flags.string()`, `@args.string()` */
const INPUT_DECORATORS = new Set(['flags', 'args'])

/**
 * The input DETs of a command: its `@flags.*` and `@args.*`, named as the
 * operator types them — `flagName` / `argumentName` when given, the property
 * otherwise. Returned as `flags.<name>` / `args.<name>` so the counter can say
 * which is which.
 */
export function commandFieldsOf(cls: ClassDeclaration): string[] {
  const fields: string[] = []
  for (const property of cls.getProperties()) {
    for (const decorator of property.getDecorators()) {
      const call = decorator.getCallExpression()
      const callee = call?.getExpression()
      if (!call || !callee || !Node.isPropertyAccessExpression(callee)) continue
      const kind = callee.getExpression().getText()
      if (!INPUT_DECORATORS.has(kind)) continue

      const options = call.getArguments()[0]
      const renamed =
        options && Node.isObjectLiteralExpression(options)
          ? (['flagName', 'argumentName']
              .map((key) => options.getProperty(key))
              .find((p) => p && Node.isPropertyAssignment(p)) as
              import('ts-morph').PropertyAssignment | undefined)
          : undefined
      const literal = renamed?.getInitializer()
      const name =
        literal && Node.isStringLiteral(literal) ? literal.getLiteralValue() : property.getName()
      fields.push(`${kind}.${name}`)
    }
  }
  return fields
}

/** is this class an ace command? — the graph asks, to read its flags as input */
export function isCommandClass(cls: ClassDeclaration): boolean {
  const baseCommand = baseCommandNameIn(cls.getSourceFile())
  return !!baseCommand && cls.getExtends()?.getExpression().getText() === baseCommand
}
