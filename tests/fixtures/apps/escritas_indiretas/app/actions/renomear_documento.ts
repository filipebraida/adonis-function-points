import type Documento from '#models/documento'

/** the dominant shape on the reviewed application: destructured parameter, NAMED interface, in the same file */
interface RenomearInput {
  documento: Documento
  nome: string
}

export default class RenomearDocumento {
  async handle({ documento, nome }: RenomearInput): Promise<Documento> {
    documento.nome = nome
    await documento.save()
    return documento
  }
}
