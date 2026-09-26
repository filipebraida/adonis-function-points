import vine from '@vinejs/vine'

export const criarProdutoValidator = vine.create(
  vine.object({
    nome: vine.string(),
    preco: vine.number(),
    categoria: vine.string(),
    fornecedorId: vine.number(),
  })
)
