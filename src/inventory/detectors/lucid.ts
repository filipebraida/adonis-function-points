import type { CallExpression } from 'ts-morph'

import type { PersistenceAccess } from '../resolvers/types.js'
import type { PersistenceDetector, ResolverContext } from '../resolvers/types.js'

/**
 * Detecta acesso a dados via Lucid.
 *
 * CUIDADO com os falsos positivos medidos no spike:
 *   `.related('x')`  é acessor de relação, usado tanto para ler quanto para
 *                    escrever — só conta como escrita se terminar em
 *                    attach/detach/sync/save/create.
 *   `.create(`       aparece em `vine.create(` e em vários builders; só conta
 *                    quando o receptor resolve para um model conhecido.
 *
 * Detecção em nível de ARQUIVO é inútil: um service com 38 escritas marca como
 * escritor todo mundo que o importa. Tem que ser no call site.
 */
export const WRITE_METHODS = new Set([
  'save',
  'delete',
  'create',
  'createMany',
  'merge',
  'fill',
  'updateOrCreate',
  'firstOrCreate',
  'attach',
  'detach',
  'sync',
  'increment',
  'decrement',
  'update',
  'truncate',
])

export const READ_METHODS = new Set([
  'find',
  'findOrFail',
  'findBy',
  'findByOrFail',
  'first',
  'firstOrFail',
  'all',
  'query',
  'preload',
  'load',
  'paginate',
  'count',
])

export const lucidDetector: PersistenceDetector = {
  name: 'lucid',
  order: 10,

  detect(_call: CallExpression, _ctx: ResolverContext): PersistenceAccess | null {
    // TODO: implementar. Ver docs/research/spike-findings.md para os casos
    // que precisam ser cobertos e para os falsos positivos já identificados.
    return null
  },
}
