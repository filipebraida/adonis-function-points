import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { NormalizeConstructor } from '@adonisjs/core/types/helpers'

/** Fábrica de mixin: local à aplicação, mas a coluna só existe no retorno. */
export function withSlug() {
  return <T extends NormalizeConstructor<typeof BaseModel>>(superclass: T) => {
    class WithSlug extends superclass {
      @column()
      declare slug: string
    }
    return WithSlug
  }
}
