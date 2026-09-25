import vine from '@vinejs/vine'

export const criarTarefaValidator = vine.create(
  vine.object({
    titulo: vine.string().minLength(1),
  })
)
