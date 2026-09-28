import permissoes from '@acme/permissoes/services/main'

export async function criarPapel(nome: string) {
  await permissoes.store.criarPapel(nome)
}
