import Documento from '#models/documento'

/** a same-class helper with NO return annotation, whose every return is a store access */
export default class DuplicarDocumento {
  async handle(original: Documento): Promise<Documento> {
    const copia = await this.copia(original)
    copia.nome = `${copia.nome} (cópia)`
    await copia.save()
    return copia
  }

  private async copia(original: Documento) {
    return Documento.create({ nome: original.nome, conteudo: original.conteudo, pastaId: original.pastaId })
  }
}
