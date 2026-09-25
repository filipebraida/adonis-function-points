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
