import type Pedido from '#models/pedido'

/** an interface of the application: the implementation is bound at runtime, and there is no body here */
export interface GeradorDeRelatorios {
  gerar(pedidos: Pedido[]): Promise<string>
}
