/**
 * The fields the open object accepts, declared here because a seeder creates the
 * form. This is what `overrides.detFromSchema` names: the count keeps coming from
 * the code, so adding a field moves the number without anyone editing a config.
 */
export const intakeSchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    birthDate: { type: 'string' },
    address: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string' },
    notes: { type: 'string' },
  },
} as const

/**
 * A second template. Two fields it shares with the first, two of its own — so the
 * union is 8, not 12, because a field the user recognises in both is one DET.
 */
export const reviewSchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    email: { type: 'string' },
    reviewer: { type: 'string' },
    decision: { type: 'string' },
  },
} as const
