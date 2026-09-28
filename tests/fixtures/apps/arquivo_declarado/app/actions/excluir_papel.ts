import permissoes from '@acme/permissoes/services/main'

export async function excluirPapel(nome: string) {
  const papeis = await permissoes.store.listarPapeis()
  if (!papeis.includes(nome)) return
  await permissoes.store.excluirPapel(nome)
}
