import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import { PDFDocument } from 'pdf-lib'

import ArquivarDocumento from '#actions/arquivar_documento'
import DuplicarDocumento from '#actions/duplicar_documento'
import ExcluirDocumento from '#actions/excluir_documento'
import LimparPasta from '#actions/limpar_pasta'
import RenomearDocumento from '#actions/renomear_documento'
import Documento from '#models/documento'
import Pasta from '#models/pasta'
import Sessao from '#models/sessao'
import Usuario from '#models/usuario'
import AtribuicaoService from '#services/atribuicao_service'
import Notificador from '#services/notificador'
import Sessoes from '#services/sessoes'

/**
 * Every write here happens on an instance that arrives from OUTSIDE the body that
 * writes it: the controller loads, the action or the service alters. Six shapes, one
 * transaction each, and a seventh whose receiver nobody can read.
 */
export default class DocumentosController {
  /** destructured parameter typed by a named interface */
  async renomear({ params, request, response }: HttpContext) {
    const documento = await Documento.findOrFail(params.id)
    await new RenomearDocumento().handle({ documento, nome: request.input('nome') })
    return response.noContent()
  }

  /** imported interface, destructured after the parameter */
  async excluir({ params, request, response }: HttpContext) {
    const documento = await Documento.findOrFail(params.id)
    await new ExcluirDocumento().handle({ documento, motivo: request.input('motivo') })
    return response.noContent()
  }

  /** the written instance is what a followed method returns */
  async arquivar({ params, response }: HttpContext) {
    const documento = await Documento.findOrFail(params.id)
    await new ArquivarDocumento(new Sessoes()).handle(documento)
    return response.noContent()
  }

  /** the written instance is a row of a relation, in a `for…of` */
  async limpar({ params, response }: HttpContext) {
    const pasta = await Pasta.query().where('id', params.id).preload('documentos').firstOrFail()
    await new LimparPasta().handle(pasta)
    return response.noContent()
  }

  /** the service comes out of the container */
  async atribuir({ params, request, response }: HttpContext) {
    const documento = await Documento.findOrFail(params.id)
    const usuario = await Usuario.findOrFail(request.input('usuarioId'))
    const atribuicao = await app.container.make(AtribuicaoService)
    await atribuicao.atribuir(documento, usuario)
    return response.noContent()
  }

  /** the service is instantiated in a local */
  async notificar({ params, response }: HttpContext) {
    const documento = await Documento.findOrFail(params.id)
    const notificador = new Notificador()
    await notificador.enviar(documento)
    return response.noContent()
  }

  /** upsert: the instance is either found or new — a conditional initializer */
  async criar({ request, response }: HttpContext) {
    const id = request.input('id')
    const documento = id ? await Documento.find(id) : new Documento()
    documento!.nome = request.input('nome')
    await documento!.save()
    return response.noContent()
  }

  /** `??` over a query and a constructor: the same store either way */
  async sessao({ params, response }: HttpContext) {
    const documento = await Documento.findOrFail(params.id)
    const sessao = (await Sessao.query().where('documento_id', documento.id).first()) ?? new Sessao()
    sessao.documentoId = documento.id
    await sessao.save()
    return response.noContent()
  }

  /** the callback's parameter is a row of the relation it iterates */
  async marcar({ params, response }: HttpContext) {
    const pasta = await Pasta.query().where('id', params.id).preload('documentos').firstOrFail()
    await Promise.all(
      pasta.documentos.map(async (documento) => {
        documento.arquivado = true
        await documento.save()
      })
    )
    return response.noContent()
  }

  /** the authenticated user is the guard's model — `config/auth.ts` says which */
  async perfil({ auth, request, response }: HttpContext) {
    const usuario = auth.getUserOrFail()
    usuario.nome = request.input('nome')
    await usuario.save()
    return response.noContent()
  }

  /** a relation read off a loaded row: `documento.pasta` is a `Pasta` */
  async renomearPasta({ params, request, response }: HttpContext) {
    const documento = await Documento.query().where('id', params.id).preload('pasta').firstOrFail()
    const pasta = documento.pasta
    pasta.nome = request.input('nome')
    await pasta.save()
    return response.noContent()
  }

  /** a helper with no return annotation, whose returns are all `Documento.create(…)` */
  async duplicar({ params, response }: HttpContext) {
    const documento = await Documento.findOrFail(params.id)
    await new DuplicarDocumento().handle(documento)
    return response.noContent()
  }

  /**
   * The receiver of `save()` comes from a helper whose return nobody can type: the
   * analysis must SAY it does not know — an unresolved call — not stay silent and
   * count an EO with full coverage.
   */
  async carimbar({ params, request, inertia }: HttpContext) {
    const documento = await Documento.findOrFail(params.id)
    const alvo = alvoDe(request.input('alvo'))
    alvo.carimbadoEm = new Date()
    await alvo.save()
    return inertia.render('documentos/carimbado', { documento })
  }

  /** the rows come from a method OF THE MODEL, then a query-builder chain, then a `for…of` */
  async assinar({ params, response }: HttpContext) {
    const documento = await Documento.findOrFail(params.id)
    const pendentes = await documento.pendentes().forUpdate()
    for (const assinatura of pendentes) {
      assinatura.assinadoEm = new Date().toISOString()
      await assinatura.save()
    }
    return response.noContent()
  }

  /** a package's object with a method called `save` — pdf-lib's — is not a store, and not reported */
  async exportar({ params, response }: HttpContext) {
    const documento = await Documento.findOrFail(params.id)
    const pdf = await PDFDocument.create()
    pdf.addPage().drawText(documento.nome)
    const bytes = await pdf.save()
    response.header('content-type', 'application/pdf')
    return response.send(bytes)
  }
}

const registro = new Map<string, any>()

/** returns whatever was registered under the key: no annotation, no store — nobody can type it */
function alvoDe(chave: string) {
  return registro.get(chave)
}
