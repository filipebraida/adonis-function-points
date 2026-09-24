import Apontamento from '#ponto/models/apontamento'
import Justificativa from '#ponto/models/justificativa'

export interface JustificarApontamentoInput {
  pessoaId: number
  tipo: string
  marcadoEm: unknown
  motivo: string
  observacao?: string
}

/** Registrar apontamento junto com a justificativa: alcança as duas entidades. */
export default class JustificarApontamento {
  async handle(input: JustificarApontamentoInput) {
    const justificativa = await Justificativa.create({
      pessoaId: input.pessoaId,
      motivo: input.motivo,
      observacao: input.observacao ?? null,
    })

    return Apontamento.create({
      pessoaId: input.pessoaId,
      tipo: input.tipo,
      marcadoEm: input.marcadoEm as never,
      justificativaId: justificativa.id,
    })
  }
}
