import type Pasta from '#models/pasta'

/** the loop variable is a row of a preloaded relation: `pasta.documentos` is `Documento` */
export default class LimparPasta {
  async handle(pasta: Pasta): Promise<number> {
    let apagados = 0
    for (const documento of pasta.documentos) {
      await documento.delete()
      apagados++
    }
    return apagados
  }
}
