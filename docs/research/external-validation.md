# Validação externa

> **Registro datado — setembro/2026.** Este documento descreve o que foi medido e
> decidido naquele momento, não o comportamento atual do pacote. Conclusões
> daqui podem ter sido revistas depois; a referência viva é
> [`../design/architecture.md`](../design/architecture.md).

A revisão sênior apontou o risco #1 do projeto: o levantamento de 6 apps era
**de um único autor, com um único stack**. "Presente em 6/6" media a convenção
da casa, não o AdonisJS. Esta validação testou a tese "gerado primeiro" fora
dessa amostra.

## O que foi testado

| repo                                          | autor     | core  | lucid               | Tuyau |
| --------------------------------------------- | --------- | ----- | ------------------- | ----- |
| `adonisjs/web-starter-kit`                    | oficial   | ^6.18 | ^21.6               | não   |
| `adonisjs/inertia-starter-kit`                | oficial   | ^6.18 | ^21.6               | não   |
| `adocasts/building-with-adonisjs-and-inertia` | terceiro  | ^6.17 | ^21.6               | não   |
| `HipsterBrown/adonis-realworld-example-app`   | terceiro  | ^5.9  | ^18                 | não   |
| `RomainLanz/romainlanz.com`                   | core team | ^7.3  | **nenhum — Kysely** | sim   |

Mais a leitura do código-fonte do `@adonisjs/lucid` 22, `@adonisjs/core` 7,
`@adonisjs/assembler` 8 e `@tuyau/core` 1.2 para descobrir **quem gera o quê**.

## Resultado: quem gera cada artefato

| artefato                                                                                   | gerador                                                                                                                            | existe desde            | nas 4 apps externas                                                         |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `database/schema.ts` (`*Schema`, `$columns`)                                               | `@adonisjs/lucid` **oficial**, `migration:run` com `schemaGenerate = true` por padrão (pula em produção); também `schema:generate` | **Lucid 22** — fev/2026 | **nenhuma** (todas ≤ 21.6, onde o gerador não existe: 0 arquivos no pacote) |
| `.adonisjs/server/{controllers,events,listeners,policies}.ts`, `routes.d.ts`, `pages.d.ts` | `@adonisjs/core` **v7** (`node ace codegen`, também efeito colateral do dev server/build)                                          | core 7                  | **nenhuma** (core 6.18 não tem codegen)                                     |
| `.adonisjs/client/registry/schema.d.ts` — rotas **com tipos de body/query**                | **Tuyau** (`@tuyau/core`), terceiro, opcional                                                                                      | —                       | **nenhuma**                                                                 |

Três esclarecimentos que mudam o desenho:

1. **O gerador de schema é oficial e ligado por padrão** — não é tooling da
   casa. A tese está certa em espírito. Mas só existe no Lucid 22, e os
   **starter kits oficiais ainda estão no 21.6**. Hoje é a borda, não a base.
2. **O registry com DETs de entrada é Tuyau**, não core. O que o core v7 gera
   (`server/routes.d.ts`) tem nome e parâmetros de rota, **zero tipos de body**.
   Sem Tuyau, os DETs de entrada saem dos validators por AST — não há atalho.
3. **`.adonisjs/` não é versionado em nenhuma app externa**, e nos kits oficiais
   nem aparece no `.gitignore` (simplesmente não existe até rodar algo). Em v7
   o pacote pode **regenerar sob demanda** (`node ace codegen`,
   `node ace schema:generate`); em v6 não há o que regenerar.

## Quinta app: `romainlanz.com` (core team do AdonisJS)

Indicada pelo autor do projeto. É a que mais afasta do stack da casa e por isso
a mais valiosa:

| aspecto       | o que tem                                                                               | consequência                                                                   |
| ------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| framework     | core **7.3**, Tuyau (via `catalog:`), Inertia 4                                         | `.adonisjs/` **versionado**: registry + `controllers.ts` presentes             |
| persistência  | **Kysely + pg** — sem Lucid                                                             | `lucidDetector` inútil; escrita é `.insertInto()/.updateTable()/.deleteFrom()` |
| schema gerado | `types/db.ts` por **kysely-codegen** — `interface Articles { id; title; … }` por tabela | terceiro formato de schema gerado, sem `@column` nenhum                        |
| migrations    | DSL do Kysely (`db.schema.createTable().addColumn()`)                                   | parser de migration do Lucid não serve                                         |
| layout        | módulo por domínio, com **módulos aninhados** (`app/admin/taxonomies/`) e um `app/app/` | `moduleOf()` de um nível só erra                                               |
| repositórios  | em **`src/<módulo>/repositories/`**, fora de `app/`                                     | qualquer varredura restrita a `app/` perde 100% das escritas                   |
| injeção       | `@inject()` em 21 arquivos; `constructor(private readonly q: GetArticleBySlugQuery)`    | resolução **por tipo do parâmetro**, não por import — o caso do type checker   |
| rotas         | `preloads` → `#start/routes` → arquivo-hub que só `import`a `#articles/routes` etc.     | quarta topologia: preload → hub → módulos                                      |

`discoverApp`: `module-per-domain`, 22 aliases, registry sim, ctrl map sim,
schema **não** (correto — não há schema Lucid), `#models/user` null (correto —
não existe o alias). Comportou-se bem; o que falta é o que vem depois dele.

Três lições que entram no desenho:

1. **A coleta de repositórios precisa de um segundo coletor de verdade** —
   kysely-codegen — e de uma detecção de persistência para Kysely. Não é
   hipótese de extensibilidade; é uma app de membro do core team. (Ficou fora
   do v1, com a fixture sentinela pulada; ver `../design/architecture.md`.)
2. **`property_service` por tipo do construtor deixa de ser "depois".** Aqui é o
   único caminho da rota à escrita.
3. **A raiz de varredura não é `app/`.** É o conjunto de diretórios alcançáveis
   pelos aliases do `package.json` — `src/`, `shared/`, `types/` incluídos.

## Como o `AppContext` se comportou

| repo                | layout  | aliases | registry | ctrl map | schema | `#models/user` |
| ------------------- | ------- | ------- | -------- | -------- | ------ | -------------- |
| web-starter-kit     | flat    | 16      | não      | não      | não    | resolve        |
| inertia-starter-kit | flat    | 16      | não      | não      | não    | resolve        |
| adocasts            | flat    | 19      | não      | não      | não    | resolve        |
| realworld (v5)      | unknown | 0       | não      | não      | não    | null           |

Correto em todos: detectou layout, resolveu aliases lendo o `package.json`, e
**reportou ausência dos três gerados em vez de assumir ou quebrar**. O v5 saiu
como `unknown` / 0 aliases, que é o sinal certo de "fora do escopo".

O desenho "dizer não sei" segurou. O que não segura é a ordem das fontes.

## Outras variações encontradas fora da casa

- **Rotas em diretório**: `start/routes/web.ts` + `start/routes/auth.ts`, sem
  `start/routes.ts`. Terceira forma, além das duas já conhecidas. E uma quarta
  no `romainlanz.com`: preload de um hub que só `import`a os arquivos de módulo.
  **A fonte autoritativa é a lista `preloads` do `adonisrc.ts`, seguindo os
  `import` estáticos que ela alcança** — não convenção de caminho.
- **Referência a controller por lazy import** (`const X = () => import(...)`) em
  100% das externas — o `#generated/controllers` é exclusivo de v7.
- **Models com `@column` no próprio arquivo** em 13/13 (adocasts). O estilo
  "extends Schema gerado" é consequência direta do Lucid 22; abaixo dele, o
  parser de model por AST é o único caminho — e tem que seguir a cadeia de
  herança (`extends compose(Base, Mixin)`) para não zerar.
- **Escrita em actions** também fora da casa: 48 em actions vs 1 em controller
  (adocasts). O padrão action object não é idiossincrasia sua; é corrente na
  comunidade.

## Consequências

### A ordem das fontes inverte

O que era "gerado primeiro, AST como fallback" vira:

| #   | fonte                                                                          | papel                                                                   |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 1   | **AST** — validators, models com cadeia de herança, `routes.ts` via `preloads` | **base**: funciona em v6 e v7, com ou sem Tuyau                         |
| 2   | **gerado** — schema Lucid 22, codegen core 7, registry Tuyau                   | **upgrade de precisão** quando presente; em v7, regenerável sob demanda |
| 3   | runtime                                                                        | decisão pendente (v1 ou não)                                            |
| 4   | convenção de pasta                                                             | só relatório                                                            |

O AST deixa de ser fallback e vira o produto. Os gerados são o que torna o AST
_mais preciso_ onde existem — e o relatório diz qual fonte produziu cada fato.

### Matriz de suporte, explícita

|                        | AdonisJS 6 (core 6, Lucid 21)            | AdonisJS 7 (core 7, Lucid 22) |
| ---------------------- | ---------------------------------------- | ----------------------------- |
| models / DETs de dados | AST com herança                          | schema gerado (regenerável)   |
| rotas                  | `preloads` → parser de `routes.ts`       | idem, + `routes.d.ts` do core |
| DETs de entrada        | validators por AST                       | idem; **com Tuyau**, registry |
| controller ← rota      | lazy import por AST                      | `controllers.ts` gerado       |
| v5                     | fora do escopo, detectado como `unknown` | —                             |

### O que o `AppContext` ganha

- `routeFiles`: lidos de `adonisrc.ts` `preloads`, não adivinhados
- `framework: { core, lucid, tuyau }`: versões, para escolher a estratégia e
  para o relatório dizer em que base a contagem foi feita
- `scanRoots`: diretórios alcançáveis pelos aliases, não só `app/`

> **Corrigido depois.** Esta seção propunha um `canRegenerate` que oferecesse
> rodar `codegen`/`schema:generate` antes de contar. Vale para o `codegen` — que
> boota a app sem banco — mas **não** para o `schema:generate`, que introspecta
> o banco vivo. Sem conexão não há como regenerar o schema, então a fonte de
> dados é o arquivo versionado. Ver o escopo do v1 em `../design/architecture.md`.

### A invariante de ouro ganha uma terceira fixture

Derivada de um layout de autoria externa e **sem nenhum gerado versionado**. É a
que impede a invariante de ser só regressão do que eu mesmo escrevi.

> **Ajustado com o escopo v1.** A fixture proposta aqui era do `web-starter-kit`
> (v6). Com o v1 fixado em core 7 + Lucid 22, ela virou `minimal_nogen`: a mesma
> app em v7, porém sem `.adonisjs/` nem `database/schema.ts` versionados —
> isola a variável que interessa (o fallback por AST) sem arrastar uma versão
> fora de escopo.

## Nota sobre o próprio processo

Meio dia de verificação derrubou a premissa central de um plano de oito fases.
Foi barato porque foi feito antes da Fase 2. A lição vai para o plano como
regra: **toda afirmação "universal" tem que ser testada fora da amostra que a
gerou antes de virar dependência de desenho.**
