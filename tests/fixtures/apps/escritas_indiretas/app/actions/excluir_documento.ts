import type { ExcluirInput } from '#actions/tipos'

/** the parameter is typed by an IMPORTED interface and destructured on the next line */
export default class ExcluirDocumento {
  async handle(input: ExcluirInput): Promise<void> {
    const { documento } = input
    await documento.delete()
  }
}
