# Estratégias de rastreamento

Catálogo dos padrões de organização que aparecem em apps AdonisJS e o estado de
cada um. A lista é aberta por construção — ver
`src/inventory/resolvers/types.ts`.

| padrão | exemplo | estratégia | estado |
|---|---|---|---|
| controller gordo | `await User.create(payload)` | detector Lucid | **feito** |
| método da própria classe | `await this.persistExpiration(x)` | `same-class-method` | **feito** |
| action object | `await new CreateUser().handle(p)` | `action-object` | **feito** |
| action em variável | `const a = new CreateUser(); a.handle()` | `action-object` | **feito** |
| service estático | `await UserService.create(p)` | `static-service` | **feito** |
| service injetado | `constructor(private users: UserService)` + `this.users.create(p)` | `property-service` | **feito** — resolve pela anotação de tipo, **sem type checker** |
| repositório Kysely | `this.repo.create(p)` → `db.insertInto('users')` | `property-service` + detector Kysely | **obrigatório** — sem Lucid, é a escrita |
| função de módulo | `await createUser(p)` | `module-function` | **feito** |
| job | `await CreateUserJob.dispatch(p)` | `job-dispatch` | **feito** |
| query builder | `db.table('users').insert(p)` | detector próprio | a fazer |

## Primeira que reivindica, vence

Formas sintaticamente idênticas têm significados diferentes:
`CreateUserJob.dispatch(p)` e `UserService.create(p)` são ambas
`Identificador.metodo(args)`. Só a ORDEM separa uma da outra.

Isso não foi projetado — foi descoberto por um teste, que flagrou
`static-service` engolindo a fixture de job. Por isso `resolveCall()` para na
primeira estratégia que devolve resultado, e há um teste de regressão
afirmando qual estratégia reivindica cada padrão.

Consequência: `module-function` fica por último. Ela casa com qualquer chamada
de identificador importado e engoliria todos os casos mais precisos.

Outra armadilha da mesma família: `Invite.findByOrFail(...)` também é
`Identificador.metodo(args)`. Model é repositório de dados, não corpo a
percorrer — daí a invariante de ordem em `ResolverContext.dataStoresBySymbol`:
os DataStores são coletados ANTES de qualquer análise de handler.

## `@inject()` não precisa de type checker

Uma análise anterior deste projeto afirmou que resolver
`constructor(protected billing: BillingService)` exigiria o type checker do
TypeScript, e tratou isso como a decisão mais cara do desenho.

**Estava errado.** O `@inject()` do AdonisJS só funciona com a anotação de tipo
explícita — é dela que o container tira o que injetar. Então o tipo está sempre
no AST, como identificador importado, e resolve pelo mesmo caminho de qualquer
import.

Importava muito: numa app de produção, 68 rotas de escrita paravam no primeiro
passo com `this.algumServiço.metodo()`. Resolver isso levou a detecção de EE de
40 para 84 em 161 rotas.

## Decisão tomada: jobs

Quando o handler despacha um job que escreve, a escrita é parte da **mesma**
função transacional, ou é uma função própria?

O IFPUG conta pelo que o usuário reconhece. Se a pessoa clica "finalizar" e o
efeito esperado acontece, é uma transação só — mesmo que a execução seja
assíncrona. Isso sugere seguir o job como parte da transação que o despacha.

Mas um job **agendado**, que ninguém dispara, é um ponto de entrada próprio e
deve ser coletado por um `EntryPointCollector`.

**Decisão:** o job despachado por um handler é seguido como parte da mesma
função transacional. Job agendado, que ninguém dispara, é ponto de entrada
próprio e sai de um `EntryPointCollector`.

## Ordem

`order` menor roda primeiro. Estratégias específicas antes das genéricas:
`module-function` por último, porque casa com qualquer chamada de identificador
importado e engoliria os casos mais precisos.

Estratégias vindas da config do usuário entram antes das embutidas.
