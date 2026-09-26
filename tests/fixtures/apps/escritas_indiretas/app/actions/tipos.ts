import type Documento from '#models/documento'

/** the input interface lives in another file and is imported as a type */
export interface ExcluirInput {
  documento: Documento
  motivo: string
}
