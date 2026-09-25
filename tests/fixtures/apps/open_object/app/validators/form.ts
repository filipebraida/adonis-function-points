import vine from '@vinejs/vine'

/**
 * `answers` is an open object: the fields the user fills are declared nowhere in
 * the code, because the form's schema is data. The analysis cannot enumerate it,
 * which is the same situation as a JSON column — and the same answer: 1 DET, and
 * a warning saying so.
 *
 * Walking into the empty literal and finding nothing made the FIELD itself
 * disappear, so it counted zero.
 */
export const createFormValidator = vine.create(
  vine.object({
    title: vine.string(),
    initial: vine.boolean(),
    answers: vine.object({}).allowUnknownProperties(),
  })
)

/** Nothing opaque here: the control for the override's subtraction. */
export const createNoteValidator = vine.create(
  vine.object({
    body: vine.string(),
    pinned: vine.boolean(),
  })
)

/**
 * Conditional groups. The branches are mutually exclusive at runtime and the
 * transaction can carry either, so §7.2 counts the UNION — and `shared` appears in
 * both, so it is one DET rather than two.
 *
 * The group lives in its own constant and is NOT exported, which is the shape that
 * mattered: resolving the reference in the caller's file finds nothing.
 */
const paymentBranches = vine.group([
  vine.group.if((data) => 'cardNumber' in data, {
    shared: vine.string(),
    cardNumber: vine.string(),
    cvv: vine.string(),
  }),
  vine.group.if((data) => 'iban' in data, {
    shared: vine.string(),
    iban: vine.string(),
  }),
])

export const payValidator = vine.create(vine.object({}).merge(paymentBranches))

/**
 * The same two fields, written across lines the way Prettier formats a long chain.
 *
 * The recogniser used to be a regex over the property's source text
 * (`/vine\.object/`), so `vine` and `.object` landing on different lines made the
 * field stop being recognised. A count that depends on where the formatter put a
 * newline is not a measurement.
 */
export const wrappedValidator = vine.create(
  vine.object({
    inline: vine.object({ a: vine.string(), b: vine.string() }),
    wrapped: vine
      .object({ c: vine.string(), d: vine.string() })
      .optional(),
    openWrapped: vine
      .object({})
      .allowUnknownProperties()
      .optional()
      .use(somethingElse({ note: 'an object literal further down the chain' })),
  })
)

declare function somethingElse(options: { note: string }): never
