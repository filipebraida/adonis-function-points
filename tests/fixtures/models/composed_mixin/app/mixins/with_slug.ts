import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { NormalizeConstructor } from '@adonisjs/core/types/helpers'

/** Mixin factory: local to the app, but the column only exists on the return. */
export function withSlug() {
  return <T extends NormalizeConstructor<typeof BaseModel>>(superclass: T) => {
    class WithSlug extends superclass {
      @column()
      declare slug: string
    }
    return WithSlug
  }
}
