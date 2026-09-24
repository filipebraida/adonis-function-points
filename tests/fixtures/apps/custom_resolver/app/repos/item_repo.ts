import Item from '#models/item'

/** A escrita mora aqui, alcançável só por um padrão que nenhum embutido cobre. */
export async function gravar(descricao: string) {
  return Item.create({ descricao })
}
