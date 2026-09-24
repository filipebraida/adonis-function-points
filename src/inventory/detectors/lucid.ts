import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

/**
 * Reconhece acesso a dados via Lucid num call site.
 *
 * **Nível de call site, nunca de arquivo.** Um service de domínio de uma app
 * real tem 38 escritas; perguntar "este arquivo contém escrita?" marcaria como
 * escritor todo mundo que o importa.
 *
 * Falsos positivos já medidos no spike, e por isso evitados aqui:
 *
 *   `.related('x')`    acessor de relação, usado para ler E para escrever —
 *                      só conta se terminar em attach/detach/sync/save/create
 *   `.create(`         aparece em `vine.create(` e em vários builders; só vale
 *                      quando o receptor resolve para um repositório conhecido
 *   `preIntake.save()` instância em minúscula não casa com o nome do model se
 *                      a comparação for por texto — daí o mapa de variáveis
 */

export type AccessMode = 'read' | 'write'

export type PersistenceAccess = {
  mode: AccessMode
  /** id do repositório de dados alcançado */
  store: string
  method: string
  line: number
  /**
   * Repositório alcançado por RELAÇÃO, não diretamente.
   *
   * `Book.query().preload('author')` lê a tabela de autores. Pela AFP isso é um
   * FTR sobre `Author`, e ignorá-lo faria uma tabela lida só por relação cair
   * fora da contagem (§6.5.4) quando é um AIE legítimo.
   */
  viaRelation?: string
}

const WRITE_METHODS = new Set([
  'save',
  'delete',
  'create',
  'createMany',
  'merge',
  'fill',
  'updateOrCreate',
  'fetchOrCreateMany',
  'firstOrCreate',
  'updateOrCreateMany',
  'attach',
  'detach',
  'sync',
  'increment',
  'decrement',
  'update',
  'truncate',
  'restore',
  'forceDelete',
])

const READ_METHODS = new Set([
  'find',
  'findOrFail',
  'findBy',
  'findByOrFail',
  'findMany',
  'first',
  'firstOrFail',
  'all',
  'query',
  'preload',
  'load',
  'paginate',
  'count',
  'exists',
  'related',
  'where',
  'orderBy',
])

/**
 * Símbolos que resolvem para um repositório de dados no escopo de um corpo.
 *
 * Inclui o nome do model (`Invite`) e as variáveis locais derivadas dele
 * (`const invite = await Invite.findOrFail(...)`).
 */
export type StoreSymbols = Map<string, string>

/** repositório -> suas relações declaradas */
export type RelationMap = Map<string, Record<string, string>>

export function detectAccess(
  call: CallExpression,
  symbols: StoreSymbols,
  relations: RelationMap = new Map()
): PersistenceAccess | null {
  const expression = call.getExpression()
  if (!Node.isPropertyAccessExpression(expression)) return null

  const method = expression.getName()
  const isWrite = WRITE_METHODS.has(method)
  if (!isWrite && !READ_METHODS.has(method)) return null

  const receiver = expression.getExpression()

  /**
   * Procura pelo CAMINHO antes da raiz: `input.invite.save()` tem raiz
   * `input`, que não é repositório nenhum — quem é, é `input.invite`.
   *
   * É o padrão dominante em action object com input tipado, e sem ele o grafo
   * chega na action e não enxerga a escrita.
   */
  const store =
    symbols.get(pathSymbolOf(receiver) ?? '') ?? symbols.get(rootSymbolOf(receiver) ?? '')
  if (!store) return null

  return {
    mode: isWrite ? 'write' : 'read',
    store,
    method,
    line: call.getStartLineNumber(),
    viaRelation: relationTargetOf(method, call, store, relations),
  }
}

const RELATION_ACCESSORS = new Set(['preload', 'load', 'related', 'withCount'])

/**
 * `.preload('author')` sobre um repositório com `{ author: 'Author' }` alcança
 * `Author`.
 */
function relationTargetOf(
  method: string,
  call: CallExpression,
  store: string,
  relations: RelationMap
): string | undefined {
  if (!RELATION_ACCESSORS.has(method)) return undefined

  const name = call.getArguments()[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
  if (!name) return undefined

  return relations.get(store)?.[name]
}

/**
 * Caminho pontuado de um receptor feito só de acessos a propriedade:
 * `input.invite` devolve "input.invite". Qualquer chamada no meio invalida o
 * caminho, porque aí o valor deixa de ser rastreável estaticamente.
 */
export function pathSymbolOf(node: Node): string | null {
  const parts: string[] = []
  let current: Node = node

  for (let depth = 0; depth < 20; depth++) {
    if (Node.isIdentifier(current)) return [current.getText(), ...parts].join('.')
    if (!Node.isPropertyAccessExpression(current)) return null

    parts.unshift(current.getName())
    current = current.getExpression()
  }

  return null
}

/**
 * Raiz de uma cadeia `a.b().c()` — o identificador mais à esquerda.
 *
 * Precisa atravessar `await`, chamada, acesso a propriedade e `new`, senão
 * `await new Action().handle()` e `Invite.query().where().update()` param no
 * primeiro nó e a escrita some.
 */
export function rootSymbolOf(node: Node): string | null {
  let current: Node | undefined = node

  for (let depth = 0; depth < 60 && current; depth++) {
    if (Node.isIdentifier(current)) return current.getText()
    if (current.getKind() === SyntaxKind.ThisKeyword) return 'this'

    if (
      Node.isPropertyAccessExpression(current) ||
      Node.isElementAccessExpression(current) ||
      Node.isCallExpression(current) ||
      Node.isNewExpression(current) ||
      Node.isAwaitExpression(current) ||
      Node.isParenthesizedExpression(current) ||
      Node.isNonNullExpression(current)
    ) {
      current = current.getExpression()
      continue
    }

    return null
  }

  return null
}
