import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

/**
 * A management panel written against Lucid's RAW query builder — `db.from('t')`, never
 * `Model.query()`. Until 0.12 none of these touched a store: the pages fell out of the
 * count in silence. The table named in `from` IS the store (plan 0.12 §B).
 */
export default class PainelController {
  /** an aggregate over a table: one FTR, one DET */
  async index({ inertia }: HttpContext) {
    const [{ total }] = await db.from('pedidos').where('status', 'aberto').count('* as total')
    return inertia.render('painel/index', { total })
  }

  /** a select of named columns: those columns, that store */
  async equipe({ inertia }: HttpContext) {
    const equipe = await db.from('usuarios').select('nome', 'email').orderBy('nome')
    return inertia.render('painel/equipe', { equipe })
  }

  /** a join: two stores; the selected column of the joined one, and an aggregate expression */
  async carga({ inertia }: HttpContext) {
    const carga = await db
      .from('pedidos')
      .join('usuarios', 'usuarios.id', 'pedidos.responsavel_id')
      .select('usuarios.nome', db.raw('count(*) as total'))
      .groupBy('usuarios.nome')
    return inertia.render('painel/carga', { carga })
  }

  /** an update through the builder: a write — an EI */
  async reatribuir({ params, request, response }: HttpContext) {
    await db
      .from('pedidos')
      .where('id', params.id)
      .update({ responsavel_id: request.input('responsavelId') })
    return response.noContent()
  }

  /** an insert inside a transaction, through the client: a write */
  async lote({ request, response }: HttpContext) {
    await db.transaction(async (trx) => {
      await trx.table('pedidos').insert({ descricao: request.input('descricao'), status: 'aberto' })
    })
    return response.created({})
  }

  /** the pivot of a declared many-to-many: reading it is reading the relation — both stores */
  async pares({ inertia }: HttpContext) {
    const [{ total }] = await db.from('pedido_usuario').count('* as total')
    return inertia.render('painel/pares', { total })
  }

  /** a table no model declares: not a store the count knows — an unresolved call, never silence */
  async config({ inertia }: HttpContext) {
    const config = await db.from('configuracoes').where('chave', 'painel').first()
    return inertia.render('painel/config', { config })
  }

  /** a table named by an expression: the analysis cannot read it — an unresolved call, never silence */
  async arquivo({ request, response }: HttpContext) {
    const tabela = request.input('arquivados') ? 'pedidos_arquivados' : 'pedidos'
    const [{ total }] = await db.from(tabela).count('* as total')
    return response.json({ total })
  }

  /** raw SQL, a literal string: the table read off the `from` */
  async sql({ response }: HttpContext) {
    const linhas = await db.rawQuery('select status, count(*) as total from pedidos group by status')
    return response.json(linhas.rows)
  }
}
