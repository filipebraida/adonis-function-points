import { Node, Project, SyntaxKind } from 'ts-morph'
import type { ObjectLiteralExpression } from 'ts-morph'

import type { AppContext } from '../app_context.js'
import { toPosix } from '../paths.js'
import type { Provenance } from '../../types.js'

/**
 * JSON Schema literals declared in the application's own code.
 *
 * Some applications store what the user fills as data — a form definition in a
 * JSON column — which counting-decisions §8 says counts as 1 DET, because the
 * schema is runtime data. That is true of the row in the database and false of
 * the literal that seeded it: when the schema is an object literal in a seeder,
 * it is code, and ts-morph reads it.
 *
 * This matters more than the number it yields. A hand-declared DET count
 * freezes: someone adds a field, the count does not move, and `fp:diff` reports
 * no change for real functional growth — undercounting silently and
 * progressively, which is worse than undercounting once. Reading the schema
 * keeps the number coming from the code, which is the property the whole package
 * rests on.
 *
 * The leaf rules are §7's, unchanged — the same ones applied to VineJS
 * validators. Only the recognition differs: `properties` and `items` instead of
 * `vine.object` and `vine.array`.
 */

export type DiscoveredSchema = {
  /** the declared name, which is what a config override refers to */
  name: string
  /** user-recognisable fields, by the §7 leaf rules */
  fields: number
  /** the leaf paths, so `fp:explain` can show where the number came from */
  leaves: string[]
  provenance: Provenance
}

export function collectJsonSchemas(app: AppContext): Map<string, DiscoveredSchema> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  })

  /**
   * Wider than `scanRoots`, and only here.
   *
   * `database/` is excluded from the application roots on purpose: test factories
   * and migrations contain real persistence calls, and scanning them would turn a
   * test write into a counted function. But `node ace make:seeder` puts seeders in
   * `database/seeders`, which is where seed data — and therefore a form's schema —
   * normally lives. Reading a literal counts nothing, so there is no conflict: the
   * exclusion protects the call graph, not the schema catalogue.
   *
   * Without this, `overrides.detFromSchema` naming a schema declared in a seeder
   * reported "not declared anywhere in the code" and left the DET count at the
   * floor — the exact case the override exists for.
   */
  for (const root of [...app.scanRoots.map(toPosix), `${toPosix(app.root)}/database`]) {
    project.addSourceFilesAtPaths(`${root}/**/*.ts`)
  }

  const found = new Map<string, DiscoveredSchema>()

  for (const file of project.getSourceFiles()) {
    for (const declaration of file.getVariableDeclarations()) {
      const initializer = unwrap(declaration.getInitializer())
      const literal = initializer?.asKind(SyntaxKind.ObjectLiteralExpression)
      if (!literal || !isJsonSchema(literal)) continue

      const leaves = leavesOf(literal)
      if (leaves.length === 0) continue

      found.set(declaration.getName(), {
        name: declaration.getName(),
        fields: leaves.length,
        leaves,
        provenance: {
          file: toPosix(file.getFilePath()),
          line: declaration.getStartLineNumber(),
          by: 'json-schema',
        },
      })
    }
  }

  return found
}

/** `{ … } as const` and `{ … } satisfies X` still hold the literal */
function unwrap(node: Node | undefined): Node | undefined {
  if (!node) return undefined
  if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node))
    return unwrap(node.getExpression())
  return node
}

/**
 * Recognised by shape, never by name.
 *
 * A const called `schema` may be anything; an object declaring `type: 'object'`
 * with a `properties` map is a JSON Schema whatever it is called.
 */
function isJsonSchema(literal: ObjectLiteralExpression): boolean {
  const type = literal.getProperty('type')?.asKind(SyntaxKind.PropertyAssignment)
  const declared = type?.getInitializer()?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()

  return declared === 'object' && literal.getProperty('properties') !== undefined
}

/**
 * Leaves of a JSON Schema, by the table in counting-decisions §7.
 *
 *   scalar                  1
 *   nested object           leaves counted individually
 *   array of scalar         1  (repeating group)
 *   array of object         the object's leaves, once
 *   enum / const            1
 */
function leavesOf(literal: ObjectLiteralExpression, prefix = ''): string[] {
  const properties = literal.getProperty('properties')?.asKind(SyntaxKind.PropertyAssignment)
  const items = literal.getProperty('items')?.asKind(SyntaxKind.PropertyAssignment)

  if (properties) {
    const map = properties.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression)
    if (!map) return []

    return map.getProperties().flatMap((property) => {
      const assignment = property.asKind(SyntaxKind.PropertyAssignment)
      if (!assignment) return []

      const name = assignment.getName().replace(/['"]/g, '')
      const path = prefix ? `${prefix}.${name}` : name
      const nested = unwrap(assignment.getInitializer())?.asKind(SyntaxKind.ObjectLiteralExpression)

      const inner = nested ? leavesOf(nested, path) : []
      return inner.length > 0 ? inner : [path]
    })
  }

  // a repeating group counts on its first occurrence only
  if (items) {
    const element = unwrap(items.getInitializer())?.asKind(SyntaxKind.ObjectLiteralExpression)
    const inner = element ? leavesOf(element, prefix) : []
    return inner.length > 0 ? inner : [prefix]
  }

  return []
}
