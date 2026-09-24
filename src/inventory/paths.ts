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

/** Compares two paths that may have come from different sources. */
export const samePath = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && toPosix(a) === toPosix(b)
