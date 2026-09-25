import vine from '@vinejs/vine'

/** POST /livros: 3 input DETs */
export const criarLivroValidator = vine.create(
  vine.object({
    titulo: vine.string().minLength(1),
    isbn: vine.string(),
    autorId: vine.number().positive(),
  })
)
