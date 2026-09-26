import path from 'node:path'

/**
 * One canonical spelling for every path the inventory emits.
 *
 * Two path styles meet in this package. ts-morph always returns forward
 * slashes, including on Windows; node's `path.join` returns backslashes there.
 * Both end up in `HandlerRef.file`, and the call graph uses that string as a
 * cache key:
 *
 *     const key = `${ref.file}#${ref.member ?? ref.line ?? '*'}`
 *
 * Two spellings of the same file are two keys, so the same body would be
 * analysed twice and pushed twice into the trace and the implementation scope
 * — and a repeated scope entry changes the hash `fp:diff` compares.
 *
 * Forward slashes win because ts-morph cannot be told otherwise, node's `fs`
 * accepts them on Windows, and `path.relative` normalises mixed input anyway.
 * Normalising at the boundary where a path is created costs one call; leaving
 * it to each comparison costs vigilance forever.
 */
export const toPosix = (value: string) => value.split('\\').join('/')

/**
 * A path as it should appear in an EMITTED artefact: relative to the application.
 *
 * `CountSource.app` is documented as never being the absolute path, because that
 * says where the machine keeps its files and travels with every count sent
 * anywhere. One field below it, `config` shipped the absolute path — and so did
 * every `trace[].file`, 858 times in a single production count. The rule was
 * stated and then applied to one field.
 *
 * Internally the absolute path is the right thing: it is what ts-morph resolves
 * and what the call graph keys its caches on. So this converts at the boundary
 * where a path LEAVES, and nowhere else.
 *
 * A path outside the root keeps its `../` prefix, which describes where it is
 * without naming the home directory.
 */
export const relativeTo = (root: string, value: string) =>
  toPosix(path.relative(toPosix(root), toPosix(value))) || '.'

/** Compares two paths that may have come from different sources. */
export const samePath = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && toPosix(a) === toPosix(b)

/**
 * Is this file the application's own code, as opposed to the scaffolding around it?
 *
 * The top-level filter on `scanRoots` already drops `tests/`, `database/` and the
 * rest — but only at the ROOT. Applications organised by domain module put both
 * inside `app/`:
 *
 *     app/billing/tests/functional/invoice.spec.ts
 *     app/billing/seeders/plan_seeder.ts
 *
 * so they land in the project, and `writtenAnywhere()` read a seeder's inserts as
 * the application maintaining the table. A reference table only the seed populates
 * came out as an ILF — which the CPM does not allow: data maintained by the
 * development team is at most an EIF, and code data is not counted at all.
 *
 * The segments are AdonisJS's own: `make:test` writes to a suite directory,
 * `make:seeder` to `seeders`, `make:migration` to `migrations`, `make:factory` to
 * `factories`. The `.spec`/`.test` suffixes come from the suite globs in
 * `adonisrc.ts`.
 */
const SCAFFOLDING = new Set(['tests', 'test', 'seeders', 'seeder', 'migrations', 'factories'])

/** a seeder, by the directory `make:seeder` writes to — scaffolding, but a fact the report uses */
export function isSeeder(root: string, file: string): boolean {
  const relative = relativeTo(root, file)
  if (relative.startsWith('..')) return false
  return relative
    .split('/')
    .slice(0, -1)
    .some((segment) => segment === 'seeders' || segment === 'seeder')
}

export function isApplicationCode(root: string, file: string): boolean {
  const relative = relativeTo(root, file)
  if (relative.startsWith('..')) return false

  const parts = relative.split('/')
  const name = parts.at(-1) ?? ''

  if (/\.(spec|test)\.[jt]s$/.test(name)) return false

  return !parts.slice(0, -1).some((segment) => SCAFFOLDING.has(segment))
}
