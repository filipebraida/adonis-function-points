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

/** the same appointment, as a DTO class — the shape a real application used */
export class AgendamentoDto {
  declare data: string
  declare local: string
  declare situacao: string

  constructor(data: string, local: string, situacao: string) {
    this.data = data
    this.local = local
    this.situacao = situacao
  }

  get resumo() {
    return `${this.data} ${this.local}`
  }

  descrever() {
    return this.resumo
  }
}
