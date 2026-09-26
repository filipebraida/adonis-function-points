import { inject } from '@adonisjs/core'
import { PermissaoService } from '@acme/permissoes'

import type Usuario from '#models/usuario'

/** the application's façade over a package's authorisation service: the package answers yes or no */
@inject()
export default class Permissoes {
  constructor(private permissoes: PermissaoService) {}

  pode(usuario: Usuario, capacidade: string): Promise<boolean> {
    return this.permissoes.pode(usuario.id, capacidade)
  }
}
