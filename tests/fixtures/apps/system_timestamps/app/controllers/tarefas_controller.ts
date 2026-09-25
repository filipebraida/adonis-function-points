import type { HttpContext } from '@adonisjs/core/http'

import Tarefa from '#models/tarefa'
import TarefaTransformer from '#transformers/tarefa_transformer'
import { criarTarefaValidator } from '#validators/tarefa'

export default class TarefasController {
  /** every column — minus the key and the two the system stamps */
  async index({ inertia }: HttpContext) {
    const tarefas = await Tarefa.query().orderBy('titulo')
    return inertia.render('tarefas/index', { tarefas })
  }

  /** the transformer emits `createdAt`; it is still not a DET */
  async recentes({ inertia }: HttpContext) {
    const tarefas = await Tarefa.query().orderBy('createdAt', 'desc')
    return inertia.render('tarefas/recentes', { tarefas: TarefaTransformer.transform(tarefas) })
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(criarTarefaValidator)
    await Tarefa.create(payload)
    return response.redirect().toRoute('tarefas.index')
  }
}
