import type Pedido from '#models/pedido'

/** a view counter: the page writes, but to show, not to maintain */
export async function registrarVisita(pedido: Pedido) {
  pedido.visualizacoes += 1
  await pedido.save()
}
