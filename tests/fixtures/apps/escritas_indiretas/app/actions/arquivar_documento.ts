import { inject } from '@adonisjs/core'

import type Documento from '#models/documento'
import Sessoes from '#services/sessoes'

/** the instance written comes back from a method of an injected service */
@inject()
export default class ArquivarDocumento {
  constructor(protected sessoes: Sessoes) {}

  async handle(documento: Documento): Promise<void> {
    const sessao = await this.sessoes.ativa(documento)
    if (!sessao) return
    sessao.encerradaEm = new Date().toISOString()
    await sessao.save()
  }
}
