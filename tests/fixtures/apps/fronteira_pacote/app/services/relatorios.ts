import type Pedido from '#models/pedido'

/** the CONTROL: a service of the application the resolver cannot find a body for — this one stays a gap */
export default class Relatorios {
  constructor(private gerador: GeradorDeRelatorios) {}

  async resumo(pedidos: Pedido[]) {
    return this.gerador.gerar(pedidos)
  }
}

interface GeradorDeRelatorios {
  gerar(pedidos: Pedido[]): Promise<string>
}
