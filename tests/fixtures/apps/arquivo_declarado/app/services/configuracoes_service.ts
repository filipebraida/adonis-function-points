import cache from '@acme/cache/services/main'

import type { Configuracoes } from '#types/configuracoes'

const CHAVE = 'configuracoes'

/** settings kept in a persistent cache: the code cannot tell this cache from a technical one */
export default class ConfiguracoesService {
  async get(): Promise<Configuracoes> {
    const salvas = (await cache.use('persistente').get({ key: CHAVE })) as Configuracoes | null
    if (salvas) return salvas
    const padrao = { prazoDias: 30, metaPct: 85, atualizadoEm: new Date().toISOString() }
    await this.salvar(padrao)
    return padrao
  }

  async atualizar(payload: { prazoDias: number; metaPct: number }): Promise<Configuracoes> {
    const novas = { ...payload, atualizadoEm: new Date().toISOString() }
    await this.salvar(novas)
    return novas
  }

  private async salvar(configuracoes: Configuracoes) {
    await cache.use('persistente').set({ key: CHAVE, value: configuracoes })
  }
}
