import type Documento from '#models/documento'
import Historico from '#models/historico'
import type Usuario from '#models/usuario'

/** resolved by the container in the controller: `await app.container.make(AtribuicaoService)` */
export default class AtribuicaoService {
  async atribuir(documento: Documento, usuario: Usuario): Promise<void> {
    documento.responsavelId = usuario.id
    await documento.save()
    await Historico.create({ documentoId: documento.id, usuarioId: usuario.id, quando: new Date().toISOString() })
  }
}
