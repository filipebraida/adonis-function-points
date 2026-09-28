import Categoria from '#models/categoria'

/** the default catalogue, created the first time anybody reads it */
export async function garantirCatalogo() {
  const existentes = await Categoria.query().count('* as total')
  if (Number(existentes[0].$extras.total) > 0) return
  await Categoria.createMany([{ nome: 'Geral' }, { nome: 'Urgente' }])
}
