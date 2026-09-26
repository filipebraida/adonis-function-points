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

export type TechnicalPattern = {
  /** printed in the report beside the exclusion */
  label: string
  /** tested against the physical table name; a string is compiled case-insensitively */
  pattern: RegExp | string
}

/**
 * Naming conventions, with the defaults given by the spec itself (§6.5.2.1.3)
 * plus the one AdonisJS asks for.
 *
 * The standard treats these as user-provided inputs, so `boundary.technicalPatterns`
 * REPLACES this list when set — a team that finds `.+types?` catching its
 * business data drops it there — and `boundary.business` restores one table.
 *
 * `token` is not in the spec's list and is here because the framework's own
 * tables are: `auth_access_tokens`, `remember_me_tokens`, `password_reset_tokens`.
 * A token is the machinery of authentication, not data the user maintains, and
 * on two applications it came out as an ILF at 7 PF each.
 */
export const DEFAULT_TECHNICAL_PATTERNS: TechnicalPattern[] = [
  {
    label: 'temporary entity',
    pattern: /^(.+temp|.*session.*|.*error.*|.*search.*|.*login.*|.*logon.*|.*filter.*)$/i,
  },
  { label: 'status entity', pattern: /^(.+status)$/i },
  { label: 'lookup entity', pattern: /^(lkp_.+|.+types?|.+_t)$/i },
  { label: 'template entity', pattern: /^(.*template.*)$/i },
  { label: 'token entity', pattern: /^(.*tokens?.*)$/i },
]

export function isTechnical(
  store: CollectedDataStore,
  patterns: TechnicalPattern[] = DEFAULT_TECHNICAL_PATTERNS
): string | null {
  const table = store.table ?? store.name

  for (const { label, pattern } of patterns) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern
    if (regex.test(table)) return `${label} (AFP §6.5.2.1.3: ${regex.source})`
  }

  return null
}
