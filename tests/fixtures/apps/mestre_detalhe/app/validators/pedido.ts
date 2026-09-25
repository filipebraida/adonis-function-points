import vine from '@vinejs/vine'

export const criarPedidoValidator = vine.create(
  vine.object({
    cliente: vine.string().minLength(1),
    observacao: vine.string().optional(),
    emitidoEm: vine.date({ formats: ['iso8601'] }),
  })
)

export const adicionarItemValidator = vine.create(
  vine.object({
    produto: vine.string().minLength(1),
    quantidade: vine.number().positive(),
    preco: vine.number().positive(),
  })
)

export const comentarValidator = vine.create(
  vine.object({
    autor: vine.string().minLength(1),
    texto: vine.string().minLength(1),
  })
)
