import type { AgendamentoExterno } from '#types/configuracoes'

/** reads another system through its HTTP API */
export default class AgendaService {
  async listarPorPessoa(cpf: string): Promise<AgendamentoExterno[]> {
    const resposta = await fetch(`https://agenda.example/pessoas/${cpf}/agendamentos`)
    return (await resposta.json()) as AgendamentoExterno[]
  }
}
