# Variação estrutural em aplicações AdonisJS

> **Registro datado — setembro/2026.** Este documento descreve o que foi medido e
> decidido naquele momento, não o comportamento atual do pacote. Conclusões
> daqui podem ter sido revistas depois; a referência viva é
> [`../design/architecture.md`](../design/architecture.md).

Levantamento empírico sobre **6 aplicações AdonisJS 7 de produção**, feito para
responder uma pergunta: quanto do desenho pode depender de convenção de pasta?

Resposta curta: **quase nada.** E não precisa, porque existem artefatos
gerados que atravessam todos os layouts.

## O que varia

### 1. Layout de diretórios — duas famílias incompatíveis

| forma              | apps   | caminho de um model            |
| ------------------ | ------ | ------------------------------ |
| MVC plano          | 2 de 6 | `app/models/member.ts`         |
| módulo por domínio | 4 de 6 | `app/collect/models/invite.ts` |

Os _tipos_ de artefato são os mesmos nas duas (models, controllers, services,
actions, queries, validators, transformers, jobs, policies). Só muda o
aninhamento. Mas um glob como `app/*/models/*.ts` acerta uma família e erra a
outra em 100% dos casos.

### 2. Aliases de subpath — duas convenções incompatíveis

Definidos no `imports` do `package.json` de cada app, entre 16 e 24 entradas:

```jsonc
// por tipo (MVC plano)          // por módulo
"#models/*":  "./app/models/*"   "#collect/*": "./app/collect/*"
"#services/*":"./app/services/*" "#users/*":   "./app/users/*"
```

**Qualquer resolução de `#alias` tem que ler o `imports` do `package.json`.**
Deduzir pelo formato é errado — foi o que eu fiz no spike e só funcionava numa
das duas famílias.

### 3. Onde mora a lógica de escrita

Contagem de chamadas de escrita por tipo de artefato:

| app         | controllers | services | actions | queries | jobs | models |
| ----------- | ----------- | -------- | ------- | ------- | ---- | ------ |
| starter-kit | 0           | 3        | **15**  | 0       | 0    | 3      |
| app B       | 14          | 16       | **92**  | 0       | 0    | 0      |
| app D       | 1           | 7        | **33**  | 0       | 5    | 3      |
| app C       | 27          | **154**  | 131     | 8       | 63   | 5      |
| app A       | 0           | 1        | **135** | 0       | 1    | 1      |

Nenhuma aplicação é pura. A mais concentrada (`app A`) ainda espalha por 4 tipos;
a mais dispersa usa os 6. **Há escrita dentro de models** em 4 das 6 — hooks do
Lucid (`@afterCreate` e afins).

Consequência: o rastreamento não pode privilegiar nenhum tipo de artefato. Tem
que seguir o grafo de chamadas onde ele for.

### 4. Definição de model — a variação mais perigosa

| estilo         | exemplo                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| direto         | `class Invite extends BaseModel` com `@column` no próprio arquivo       |
| base própria   | `class Invite extends BaseModel` onde `BaseModel` é local, não do Lucid |
| schema gerado  | `class Member extends MemberSchema` — sem nenhum `@column`              |
| schema + mixin | `class User extends compose(UserSchema, Auditable)`                     |

Em `app A`, **35 arquivos de model e zero `extends BaseModel` do Lucid**; só 3 têm
`@column`. Detectar model por `extends BaseModel` ou contar DET por `@column` no
arquivo do model produziria contagem zero para a app inteira — **em silêncio**.

Esse é o tipo de falha que o pacote precisa tornar impossível.

### 5. Rotas

- **Arquivo**: `start/routes.ts` único (2 de 6) ou `app/<módulo>/routes.ts`
  (4 de 6, até 14 arquivos).
- **Referência ao controller**: mapa gerado `#generated/controllers` (5 de 6) ou
  `const X = () => import(...)` (1 de 6).
- **Sem controller nenhum**: `router.on('/sobre').renderInertia(...)` aparece em
  3 apps. É função transacional (apresenta dados ao usuário) sem handler para
  analisar.
- **Registradas por terceiros**: `transmit.registerRoutes(...)` — invisível para
  análise estática.
- **`.resource()`**: de 1 a 14 usos por app, expandindo para até 7 rotas cada.

### 6. Camada de saída

`transformers` em 5 de 6, `dtos` em 1, e nomes como `resources`, `schemas`,
`collections`, `content`, `mixins`, `support`. A lista é aberta.

## O que NÃO varia — nesta amostra

> **Ressalva adicionada após a validação externa**
> ([`external-validation.md`](external-validation.md)): as 6 apps são de um
> único autor, todas em AdonisJS 7 + Lucid 22 + Tuyau. Os artefatos abaixo são
> gerados por tooling oficial, mas **só existem nessa combinação**. Os starter
> kits oficiais (core 6.18, Lucid 21.6) não têm nenhum deles. Ver a matriz de
> suporte no documento de validação.

Duas espinhas **geradas**, presentes nas 6 aplicações, independentes de layout:

### `.adonisjs/client/registry/schema.d.ts` — as transações

```ts
export interface Registry {
  'invites.store': {
    methods: ["POST"]
    pattern: '/invites'
    types: { body: {...}, params: {...}, query: {...}, response: ... }
  }
}
```

157 a 164 rotas por app. Traz nome, verbo, padrão e os tipos de corpo e query
inferidos do VineJS — ou seja, **os DETs de entrada**. Acompanhado de
`.adonisjs/server/controllers.ts`, que dá o mapa nome → arquivo do controller.

### `database/schema.ts` — as funções de dados

```
/**
 * This file is automatically generated
 * Run "node ace migration:run" command to re-generate this file
 */
export class AcompanhamentoSchema extends BaseModel {
  static $columns = ['ano', 'cargo', 'egressoId', ...] as const
  @column() declare ano: number
```

Gerado a partir das migrations, com **lista canônica de colunas**. Presente nas
6 apps, de 2 a 48 classes:

| app                       | classes | colunas |
| ------------------------- | ------- | ------- |
| starter-kit               | 8       | 55      |
| app B                     | 45      | 395     |
| app D                     | 17      | 152     |
| app C                     | 39      | 400     |
| app A                     | 48      | 406     |
| adonis-modal (playground) | 2       | 11      |

O caminho varia (`app/core/database/schema.ts` ou `database/schema.ts`), mas o
arquivo se identifica pelo cabeçalho de geração e pelas classes `*Schema`.

**Correção ao spike:** parseando `app/*/models/*.ts` eu achei 317 colunas numa
app onde o schema gerado tem 400. O spike subcontou DETs em ~20%, e a figura de
203 PF em funções de dados está baixa na mesma proporção.

## Consequência de desenho

### Não classificar por pasta

A pergunta "regex de pastas ou lista de pastas configurável?" tem uma terceira
resposta, melhor: **para contar, o tipo de pasta é irrelevante.**

| o que a contagem precisa            | de onde vem                               | depende de pasta? |
| ----------------------------------- | ----------------------------------------- | ----------------- |
| funções de dados e seus DETs        | `database/schema.ts` gerado               | não               |
| transações, verbos, DETs de entrada | registry gerado                           | não               |
| corpo do handler                    | `controllers.ts` gerado, ou o AST da rota | não               |
| onde a escrita acontece             | grafo de chamadas a partir do handler     | não               |
| se é escrita                        | call site sobre símbolo de data store     | não               |

Pasta serve para três coisas, todas secundárias:

1. **agrupar no relatório** (PF por módulo)
2. **configurar a fronteira** (excluir módulo de infraestrutura)
3. **override** de casos exóticos que o detector não pegou

Nunca para _encontrar_ as coisas. Um pacote que encontra models em
`app/**/models/` conta zero em `app A`.

### Gerado primeiro, AST depois, convenção nunca

> **Invertido depois.** A validação externa mostrou que os artefatos gerados só
> existem em core 7 + Lucid 22 + Tuyau. A ordem em vigor é AST como base e
> gerado como upgrade de precisão — ver
> [`external-validation.md`](external-validation.md) e o escopo do v1 em
> `../design/architecture.md`. A ordem abaixo é a que esta medição sugeria.

Ordem de preferência das fontes:

1. **artefato gerado** — registry, `database/schema.ts`. Canônico, atravessa
   layouts, derivado da verdade (migrations e rotas registradas).
2. **runtime** — `router.toJSON()`, metadados do Lucid. Exato, mas exige bootar.
3. **AST** — para o que é inerentemente heurístico: o grafo de chamadas e a
   detecção de escrita.
4. **convenção de pasta** — só como metadado de relatório.

### Ressalva operacional

`.adonisjs/` e `database/schema.ts` são gerados, e nas apps medidas estão
versionados — mas isso é escolha de cada projeto. O pacote tem que:

- detectar quando estão ausentes ou obsoletos e **dizer**, não contar errado;
- oferecer caminho alternativo (bootar a app e usar `router.toJSON()`);
- nunca assumir que o registry reflete o código atual sem verificar.

## Casos que precisavam de decisão — todos decididos

Os quatro casos que este levantamento deixou em aberto viraram as decisões §1 a
§4 de [`../design/counting-decisions.md`](../design/counting-decisions.md), cada
uma com a citação normativa que a sustenta:

| caso levantado aqui                                         | decisão                                                |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `router.on(...).renderInertia(...)` — transação sem handler | §1 — não alcança dado, não conta                       |
| rotas de pacotes de terceiros (`transmit.registerRoutes`)   | §2 — infraestrutura, fora da fronteira                 |
| escrita em hook de model (`@afterCreate`)                   | §3 — pertence à transação que o disparou               |
| mixins via `compose(Schema, Auditable)`                     | §4 — o schema gerado resolve; nada de lista de pacotes |

## Aplicações levantadas

AdonisJS 7.3–7.5, todas com Inertia e Lucid. Duas de layout MVC plano, quatro
de módulo por domínio. Portes de 2 a 48 entidades e de 157 a 164 rotas.
