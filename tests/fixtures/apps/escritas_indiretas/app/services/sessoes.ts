import type Documento from '#models/documento'
import Sessao from '#models/sessao'

export default class Sessoes {
  /** the return type annotation is what names the store the caller will write */
  async ativa(documento: Documento): Promise<Sessao | null> {
    return Sessao.query().where('documento_id', documento.id).whereNull('encerrada_em').first()
  }
}
