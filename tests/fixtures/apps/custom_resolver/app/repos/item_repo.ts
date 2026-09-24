import Item from '#models/item'

/** The write lives here, reachable only through a pattern no built-in covers. */
export async function gravar(descricao: string) {
  return Item.create({ descricao })
}
