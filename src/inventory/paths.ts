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
