import { inject } from '@adonisjs/core'

import type Pedido from '#models/pedido'
import type { GeradorDeRelatorios } from '#services/gerador_de_relatorios'

/** the CONTROL: a service of the application typed by an INTERFACE — no body to follow, a gap that stays one */
@inject()
export default class Relatorios {
  constructor(private gerador: GeradorDeRelatorios) {}

  async resumo(pedidos: Pedido[]) {
    return this.gerador.gerar(pedidos)
  }
}
