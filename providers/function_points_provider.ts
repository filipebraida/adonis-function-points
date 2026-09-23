import type { ApplicationService } from '@adonisjs/core/types'

export default class FunctionPointsProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    // TODO: registrar o serviço de contagem no container
  }
}
