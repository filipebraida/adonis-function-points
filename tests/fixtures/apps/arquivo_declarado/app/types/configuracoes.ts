/** what the administrator sets on the settings screen */
export type Configuracoes = {
  prazoDias: number
  metaPct: number
  atualizadoEm: string
}

/** an appointment, as the external scheduling system returns it */
export interface AgendamentoExterno {
  data: string
  local: string
  situacao: string
}
