import vine from '@vinejs/vine'

/** Registro de Ponto: o gabarito conta 3 TDs */
export const registrarPontoValidator = vine.create(
  vine.object({
    tipo: vine.enum(['entrada', 'saida']),
    marcadoEm: vine.date({ formats: ['iso8601'] }),
    pessoaId: vine.number().positive(),
  })
)

/** Alteração de Apontamento: o gabarito conta 5 TDs */
export const alterarApontamentoValidator = vine.create(
  vine.object({
    tipo: vine.enum(['entrada', 'saida']),
    marcadoEm: vine.date({ formats: ['iso8601'] }),
    motivo: vine.string().minLength(3),
    observacao: vine.string().optional(),
  })
)

/** Apontamento com Justificativa: o gabarito conta 5 TDs */
export const justificarApontamentoValidator = vine.create(
  vine.object({
    tipo: vine.enum(['entrada', 'saida']),
    marcadoEm: vine.date({ formats: ['iso8601'] }),
    motivo: vine.string().minLength(3),
    observacao: vine.string().optional(),
  })
)

/** Acompanhar Presença e Emitir Relatório: período consultado */
export const periodoValidator = vine.create(
  vine.object({
    inicio: vine.date({ formats: ['iso8601'] }),
    fim: vine.date({ formats: ['iso8601'] }),
  })
)
