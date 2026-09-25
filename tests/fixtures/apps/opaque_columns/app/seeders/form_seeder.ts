/**
 * A JSON Schema literal, the way a seeder declares one. It is code, so
 * ts-morph reads it and the field count comes from the source rather than from
 * a number somebody has to keep in sync.
 */
export const applicationSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    address: {
      type: 'object',
      title: 'Address',
      properties: {
        street: { type: 'string' },
        city: { type: 'string' },
      },
    },
    dependents: {
      type: 'array',
      title: 'Dependents',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      },
    },
    tags: { type: 'array', items: { type: 'string' } },
  },
} as const
