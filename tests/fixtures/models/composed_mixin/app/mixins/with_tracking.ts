import { BaseModel } from '@adonisjs/lucid/orm'
import type { NormalizeConstructor } from '@adonisjs/core/types/helpers'

/** Mixin factory of the application that adds BEHAVIOUR only: no `@column`, no attribute */
export function withTracking() {
  return <T extends NormalizeConstructor<typeof BaseModel>>(superclass: T) => {
    class WithTracking extends superclass {
      touch() {
        return this
      }
    }
    return WithTracking
  }
}
