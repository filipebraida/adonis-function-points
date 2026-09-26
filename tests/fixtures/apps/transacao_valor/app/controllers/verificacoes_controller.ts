import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

import Pessoa from '#models/pessoa'
import Verificacao from '#models/verificacao'

/**
 * The value of `await db.transaction(async (trx) => { … return … })` is what the
 * callback returns — and what the caller writes afterwards. Three shapes: the value
 * destructured from a returned literal, a returned number, and a value nobody can type.
 */
export default class VerificacoesController {
  /** `{ verificacao }` picked from what the callback returns — a row, live or created */
  async store({ request, response }: HttpContext) {
    const pessoa = await Pessoa.findByOrFail('cpf', request.input('cpf'))

    const { verificacao, reutilizada } = await db.transaction(async (trx) => {
      const viva = await Verificacao.query({ client: trx })
        .where('pessoa_id', pessoa.id)
        .where('status', 'pendente')
        .first()
      if (viva) return { verificacao: viva, reutilizada: true }

      const criada = await Verificacao.create({ pessoaId: pessoa.id, status: 'pendente' }, { client: trx })
      return { verificacao: criada, reutilizada: false }
    })

    verificacao.link = `https://verificacoes.example/${verificacao.id}`
    await verificacao.save()

    return response.created({ reutilizada })
  }

  /** the callback returns a number: nothing to bind, nothing to report */
  async anular({ params, response }: HttpContext) {
    const total = await db.transaction(async (trx) => {
      const linhas = await Verificacao.query({ client: trx }).where('pessoa_id', params.id)
      for (const linha of linhas) {
        linha.status = 'anulada'
        await linha.save()
      }
      return linhas.length
    })
    return response.json({ total })
  }

  /** the callback returns what a raw query gives back: nobody can type it, and the write on it is reported */
  async carimbar({ params, response }: HttpContext) {
    const alvo = await db.transaction(async (trx) => {
      const [row] = await trx.rawQuery('select * from carimbos where pessoa_id = ? limit 1', [params.id])
      return row
    })
    alvo.status = 'carimbado'
    await alvo.save()
    return response.noContent()
  }
}
