import Apontamento from '#ponto/models/apontamento'

export interface RegistrarPontoInput {
  pessoaId: number
  tipo: string
  marcadoEm: unknown
}

export default class RegistrarPonto {
  async handle(input: RegistrarPontoInput) {
    return Apontamento.create({
      pessoaId: input.pessoaId,
      tipo: input.tipo,
      marcadoEm: input.marcadoEm as never,
    })
  }
}
