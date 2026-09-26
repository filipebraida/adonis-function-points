import { definirColecao, carregadores } from '@acme/conteudo'

/** content read from a JSON file through a package's collection: code data, not a store */
export const guias = definirColecao({
  carregador: carregadores.json('app/conteudo/guias.json'),
})
