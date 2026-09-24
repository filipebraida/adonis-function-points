import type { CollectedDataStore } from '../inventory/sources/data_stores.js'

/**
 * Temporary and technical data filter — AFP §6.5.2.1.1.
 *
 *   "Database tables identified as temporary or technical shall be marked as
 *    such to be presented in the final report, and shall be ignored in the rest
 *    of this process."
 *
 * Returns the reason when a table is technical, `null` otherwise: the report
 * must say WHY something was excluded, not merely that it was.
 */

/**
 * Naming conventions, with the defaults given by the spec itself (§6.5.2.1.3).
 *
 * The standard treats these as user-provided inputs, so they stay overridable
 * through the boundary configuration.
 */
export const DEFAULT_TECHNICAL_PATTERNS: { label: string; pattern: RegExp }[] = [
  {
    label: 'temporary entity',
    pattern: /^(.+temp|.*session.*|.*error.*|.*search.*|.*login.*|.*logon.*|.*filter.*)$/i,
  },
  { label: 'status entity', pattern: /^(.+status)$/i },
  { label: 'lookup entity', pattern: /^(lkp_.+|.+types?|.+_t)$/i },
  { label: 'template entity', pattern: /^(.*template.*)$/i },
]

export function isTechnical(
  store: CollectedDataStore,
  patterns = DEFAULT_TECHNICAL_PATTERNS
): string | null {
  const table = store.table ?? store.name

  for (const { label, pattern } of patterns) {
    if (pattern.test(table)) return `${label} (AFP §6.5.2.1.3: ${pattern.source})`
  }

  return null
}
