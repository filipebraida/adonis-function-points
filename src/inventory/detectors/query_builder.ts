/**
 * Detecta acesso a dados fora do Lucid: `db.table('x').insert(...)`,
 * `db.rawQuery(...)`, knex direto.
 *
 * Separado do detector do Lucid de propósito: trocar de ORM troca o detector,
 * não o grafo de chamadas.
 */
export {}
