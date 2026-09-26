import { BaseTransformer } from '@adonisjs/core/transformers'

import Invite from '#collect/models/invite'
import Audit from '#collect/models/audit'

/**
 * `transform()` and `paginate()` come from the package base and call back into
 * `toObject()`, which is the method the application actually writes. So the
 * body worth analysing is here, not in node_modules.
 */
export default class InviteTransformer extends BaseTransformer<Invite> {
  toObject() {
    Audit.create({ action: 'serialised' })

    return { uuid: this.resource.uuid, expiresAt: this.resource.expiresAt }
  }

  /** a VARIANT: `useVariant('forResumo')` names this method, and its keys leave too */
  forResumo() {
    return { uuid: this.resource.uuid, resumo: `${this.resource.uuid} (${this.resource.expiresAt})` }
  }
}
