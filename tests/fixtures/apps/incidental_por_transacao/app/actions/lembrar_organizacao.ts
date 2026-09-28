import Preferencia from '#models/preferencia'

/** remembers the organisation: a side effect when a page opens, the point when the user switches */
export async function lembrarOrganizacao(id: number) {
  await Preferencia.updateOrCreate({ chave: 'organizacao' }, { chave: 'organizacao', valor: String(id) })
}
