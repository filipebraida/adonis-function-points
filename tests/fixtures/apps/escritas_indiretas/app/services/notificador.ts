import type Documento from '#models/documento'
import Notificacao from '#models/notificacao'

/** instantiated in a local of the controller: `const svc = new Notificador()` */
export default class Notificador {
  async enviar(documento: Documento): Promise<void> {
    await Notificacao.create({ documentoId: documento.id, mensagem: `${documento.nome} atualizado` })
  }
}
