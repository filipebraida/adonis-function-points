import vine from '@vinejs/vine'

export const createBookValidator = vine.create(
  vine.object({
    authorId: vine.number().positive(),
    title: vine.string().minLength(1),
    isbn: vine.string().optional(),
  })
)
