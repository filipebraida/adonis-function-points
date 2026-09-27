import db from '@adonisjs/lucid/services/db'

/**
 * The actions of one person: a builder, returned for the caller to run as a subquery.
 * Imported through an alias of the application, which the type checker does not follow.
 */
export function acoesQuery(usuarioId: number) {
  return db
    .from('pedidos')
    .joinRaw('inner join usuarios as u on u.id = pedidos.responsavel_id')
    .where('u.id', usuarioId)
    .select('pedidos.status', 'u.nome')
    .as('acoes')
}
