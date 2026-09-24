import { test } from '@japa/runner'
import path from 'node:path'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectDataStores } from '../../src/inventory/sources/data_stores.js'
import { analyzeHandler } from '../../src/inventory/graph/call_graph.js'
import type { HandlerRef } from '../../src/types.js'
import { fixturePath } from '../helpers.js'

/** analisa o handler `handle` do controller indicado, dentro de uma fixture */
async function analyze(pattern: string, controller = 'expire_invite_controller.ts') {
  const root = fixturePath('patterns', pattern)
  const app = await discoverApp(root)
  const { stores } = await collectDataStores(app)

  const handler: HandlerRef = {
    file: path.join(root, 'app/collect/controllers', controller),
    member: 'handle',
  }

  return analyzeHandler(app, stores, handler)
}

/**
 * Os sete padrões são A MESMA transação escrita de formas diferentes: ler um
 * convite e expirá-lo. Todas têm que alcançar o repositório de dados e detectar
 * a escrita — senão a transação vira SE em vez de EE, e a decisão de EE vs SE
 * muda ~40% da contagem.
 */
test.group('grafo: alcança o dado em cada padrão de código', () => {
  const RESOLVIDOS = [
    'fat_controller',
    'action_object',
    'action_variable',
    'static_service',
    'module_function',
    'job_dispatch',
    'typed_input',
  ]

  for (const pattern of RESOLVIDOS) {
    test(`"${pattern}" alcança o dado e detecta a escrita`, async ({ assert }) => {
      const behavior = await analyze(pattern)

      assert.include(behavior.touches, 'Invite', `${pattern} não alcançou o repositório`)
      assert.isTrue(behavior.writes, `${pattern} não detectou escrita`)
    })
  }

  /**
   * LACUNA CONHECIDA da Fase 4a: `constructor(private users: InviteService)`
   * exige o type checker para resolver o tipo do parâmetro, e ligá-lo custa a
   * ordem de grandeza da análise inteira. Entra na 4b, medido.
   *
   * O que NÃO é aceitável é silenciar: a chamada precisa aparecer em
   * `unresolved`, senão a transação vira SE sem ninguém saber.
   */
  test('"property_service" é lacuna declarada, e aparece na cobertura', async ({ assert }) => {
    const behavior = await analyze('property_service')

    assert.isFalse(behavior.writes, 'se passou a resolver, tire da lista de lacunas')
    assert.isNotEmpty(behavior.unresolved, 'lacuna silenciosa é pior que lacuna')
    assert.match(behavior.unresolved[0].expression, /this\./)
  })
})

/**
 * Padrão dominante nas apps reais e o que mais escondia escrita: a action
 * recebe `input: ExpireInviteInput` — interface NOMEADA — e escreve em
 * `input.invite.save()`.
 *
 * O receptor não é um identificador, é um caminho de propriedade; e o model
 * chega por `import type`, nunca usado como valor. Sem resolver isso, o grafo
 * chega na action e não vê a escrita.
 */
test.group('grafo: repositório alcançado por tipo de parâmetro', () => {
  test('escrita em `input.invite.save()` é detectada', async ({ assert }) => {
    const behavior = await analyze('typed_input')

    assert.isTrue(behavior.writes, 'escrita via caminho de propriedade não foi vista')
    assert.include(behavior.touches, 'Invite')
  })

  test('a escrita é atribuída ao corpo certo', async ({ assert }) => {
    const behavior = await analyze('typed_input')
    const acao = behavior.trace.find((step) => step.file.includes('actions/'))

    assert.exists(acao)
    assert.isTrue(acao!.writes, 'a escrita acontece na action, não no controller')
  })
})

/**
 * O achado que motivou a fase: um service de domínio de uma app real tem 38
 * escritas. Detecção em nível de ARQUIVO marcaria como escritor todo mundo que
 * o importa.
 */
test.group('grafo: nível de método, não de arquivo', () => {
  test('quem chama só o método de leitura não vira escritor', async ({ assert }) => {
    const behavior = await analyze('method_level', 'list_invites_controller.ts')

    assert.include(behavior.touches, 'Invite', 'deveria alcançar o dado para ler')
    assert.isFalse(behavior.writes, 'método de leitura não pode marcar escrita')
  })

  test('quem chama o método de escrita vira escritor', async ({ assert }) => {
    const behavior = await analyze('method_level')
    assert.isTrue(behavior.writes)
  })

  test('o mesmo arquivo de service serve aos dois casos', async ({ assert }) => {
    const leitura = await analyze('method_level', 'list_invites_controller.ts')
    const escrita = await analyze('method_level')

    const servico = (steps: typeof leitura.trace) =>
      steps.find((step) => step.file.includes('invite_service'))

    assert.exists(servico(leitura.trace), 'leitura não percorreu o service')
    assert.exists(servico(escrita.trace), 'escrita não percorreu o service')
    assert.notEqual(servico(leitura.trace)!.member, servico(escrita.trace)!.member)
  })
})

test.group('grafo: rastro e procedência', () => {
  test('o rastro começa no handler e registra quem resolveu cada passo', async ({ assert }) => {
    const behavior = await analyze('action_object')

    assert.isAbove(behavior.trace.length, 1, 'rastro deveria ter mais de um passo')
    assert.equal(behavior.trace[0].depth, 0)
    assert.include(behavior.trace[0].file, 'expire_invite_controller')

    const acao = behavior.trace.find((step) => step.file.includes('actions/'))
    assert.exists(acao, 'não percorreu a action')
    assert.equal(acao!.by, 'action-object', 'o rastro tem que dizer QUEM resolveu')
    assert.isTrue(acao!.writes, 'a escrita acontece na action')
  })

  /**
   * counting-decisions §5: modificação é medida por checksum do escopo de
   * implementação. Rodar o prettier não pode virar fatura, então o hash é do
   * AST normalizado — sem whitespace e sem comentário.
   */
  test('o hash do escopo ignora formatação e comentário', async ({ assert }) => {
    const compacto = await analyze('method_level', 'expire_invite_controller.ts')
    const verboso = await analyze('method_level', 'expire_invite_verbose_controller.ts')

    const hashDoHandler = (behavior: typeof compacto) =>
      behavior.scope.find((entry) => entry.file.includes('controllers/'))!.bodyHash

    assert.equal(
      hashDoHandler(verboso),
      hashDoHandler(compacto),
      'corpos logicamente iguais têm que ter o mesmo hash — senão rodar o prettier vira fatura'
    )
  })

  test('corpo diferente muda o hash', async ({ assert }) => {
    const expirar = await analyze('method_level', 'expire_invite_controller.ts')
    const listar = await analyze('method_level', 'list_invites_controller.ts')

    const hashDoHandler = (behavior: typeof expirar) =>
      behavior.scope.find((entry) => entry.file.includes('controllers/'))!.bodyHash

    assert.notEqual(hashDoHandler(expirar), hashDoHandler(listar))
  })

  test('o hash é hexadecimal estável', async ({ assert }) => {
    const behavior = await analyze('action_object')

    assert.isNotEmpty(behavior.scope)
    for (const entry of behavior.scope) {
      assert.match(entry.bodyHash, /^[\da-f]{8,}$/)
    }
  })

  test('escopo e rastro cobrem os mesmos corpos', async ({ assert }) => {
    const behavior = await analyze('action_object')
    assert.lengthOf(behavior.scope, behavior.trace.length)
  })
})

test.group('grafo: fronteira', () => {
  /**
   * counting-decisions §1: rota que não alcança dado nenhum não é função
   * transacional. Cai da regra geral, sem caso especial.
   */
  test('handler que não toca dado não alcança repositório nenhum', async ({ assert }) => {
    const root = fixturePath('patterns', 'fat_controller')
    const app = await discoverApp(root)
    const { stores } = await collectDataStores(app)

    const behavior = analyzeHandler(app, stores, {
      file: path.join(root, 'app/collect/models/invite.ts'),
      member: 'inexistente',
    })

    assert.isEmpty(behavior.touches)
    assert.isFalse(behavior.writes)
  })

  test('profundidade máxima é respeitada', async ({ assert }) => {
    const root = fixturePath('patterns', 'action_object')
    const app = await discoverApp(root)
    const { stores } = await collectDataStores(app)

    const raso = analyzeHandler(
      app,
      stores,
      {
        file: path.join(root, 'app/collect/controllers/expire_invite_controller.ts'),
        member: 'handle',
      },
      { maxDepth: 0 }
    )

    assert.lengthOf(raso.trace, 1, 'com profundidade 0 só o próprio handler')
    assert.isFalse(raso.writes, 'a escrita está um nível abaixo')
  })
})
