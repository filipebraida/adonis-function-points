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
