# Plano de implementação

Guiado por exemplos: **cada passo começa por uma fixture com resultado
conhecido**, e só depois pelo código que a satisfaz.

Isso não é preferência de processo. Um contador de pontos de função produz um
número que vai para uma fatura, e a única forma de saber que ele está certo é
comparar com um caso cuja resposta se conhece de antemão. Se a fixture vier
depois do código, ela testa o que o código faz — não o que deveria fazer.

## A invariante de ouro

> **A mesma aplicação lógica, escrita em dois layouts diferentes, tem que
> produzir contagem idêntica.**

Uma fixture em MVC plano e outra em módulo por domínio, com as mesmas entidades
e as mesmas transações, contadas byte a byte iguais.

Esse único teste encoda todo o risco levantado no estudo: se qualquer coisa no
pacote passar a depender de convenção de pasta, de alias, ou de estilo de model,
ele falha. É o teste mais importante do projeto e é escrito **antes** do
primeiro coletor.

**Ressalva honesta:** as duas primeiras fixtures foram escritas pela mesma mão,
ao mesmo tempo, e compartilham o registry e o schema byte a byte. Elas são
regressão, não generalização. A terceira (`minimal_nogen`) é a mesma app v7
**sem nenhum gerado versionado** — testa se o fallback por AST chega à mesma
contagem. A quarta (`minimal_kysely`) fica pulada no v1 e existe para provar a
costura: quando Kysely entrar, só `sources/` e `detectors/` podem mudar.

## Taxonomia das fixtures

```
tests/fixtures/
├── apps/                     aplicações completas e mínimas
│   ├── minimal_flat/           MVC plano
│   ├── minimal_modular/        módulo por domínio — MESMA app lógica
│   ├── minimal_nogen/          MESMA app em v7, sem .adonisjs/ nem schema.ts
│   │                           versionados: prova o fallback por AST
│   ├── minimal_kysely/         MESMA app, sem Lucid — SENTINELA, pulada no v1:
│   │                           prova que Kysely entra só por sources/ e detectors/
│   ├── minimal_v6/             futuro (fora do v1): web-starter-kit oficial
│   └── vazquez/                benchmark público, gabarito 56 PF
├── patterns/                 onde mora a lógica          [7 fixtures, feito]
├── models/                   estilos de definição de model
│   ├── direct/                 @column no próprio model
│   ├── generated_schema/       extends UserSchema
│   └── composed_mixin/         compose(UserSchema, Auditable)
└── edges/                    os casos decididos em counting-decisions.md
    ├── static_route/           router.on().renderInertia()
    ├── vendor_route/           transmit.registerRoutes()
    ├── model_hook/             escrita em @afterCreate
    └── package_table/          tabela escrita só por node_modules
```

Fixtures são estáticas: o ts-morph parseia a árvore sem instalar, bootar ou ter
banco. Foi o que tornou barato ter um caso por padrão; segue barato ter um caso
por variação.

---

## Fase 1 — `AppContext`: descoberta

**Por que primeiro:** tudo depende de resolver `#alias` e de achar os gerados. E
é o que torna as duas fixtures de layout comparáveis.

Exemplos antes do código:

- resolve `#models/user` na fixture plana e `#users/models/user` na modular,
  lendo o `imports` do `package.json` de cada uma
- acha `database/schema.ts` numa e `app/core/database/schema.ts` na outra, pelo
  cabeçalho de geração — não pelo caminho
- com o registry ausente, **reporta ausência**; não assume, não inventa
- `moduleOf()` devolve o módulo na modular e um rótulo estável na plana

**Acréscimos após a validação externa:**

- `routeFiles` lidos dos `preloads` do `adonisrc.ts`, **seguindo os `import`
  estáticos** que eles alcançam — quatro topologias encontradas: arquivo único,
  um por módulo, diretório `start/routes/*.ts`, e hub que só importa módulos
- `scanRoots`: diretórios alcançáveis pelos aliases, não só `app/`
- `moduleOf()` com módulo aninhado (`admin/taxonomies`)
- `framework.orm: 'lucid' | 'kysely' | 'unknown'` e `framework.core` — fora do
  escopo v1 é **reportado**, não contado
- `framework: { core, lucid, tuyau }` — decide a estratégia e vai para o relatório
- `canRegenerate` — em v7, oferecer `codegen` / `schema:generate` antes de contar

**Pronto quando:** as três fixtures de app produzem `AppContext` equivalente,
diferindo só em `layout` e `framework`.

## Fase 2 — funções de dados: AST como base, schema gerado como upgrade

**Por que aqui:** é a metade confiável da contagem (~24% do total), e a
invariante de ordem do `ResolverContext` exige que os data stores existam antes
de qualquer análise de handler.

**Invertido após a validação externa.** O schema gerado só existe no Lucid 22;
os kits oficiais estão no 21. O parser de model por AST é a base, e precisa
**seguir a cadeia de herança** — `extends UserSchema`, `extends compose(Base,
Auditable)` — porque olhar só o arquivo zera uma app inteira.

Exemplos antes do código:

- os três estilos em `fixtures/models/` produzem **as mesmas colunas** por AST
- com schema gerado presente, `static $columns` prevalece, e o `DataStore` diz
  de qual fonte veio
- coluna acrescentada por migration de "pacote" aparece; propriedade transiente
  (como `auditComment`) não
- `minimal_v6`, sem gerado nenhum, chega ao mesmo `DataStore[]` que as outras
- `minimal_kysely`: `types/db.ts` do kysely-codegen produz o mesmo `DataStore[]`
  — segundo `DataStoreCollector`, e o relatório diz qual foi usado

**Pronto quando:** `DataStore[]` idêntico entre as quatro fixtures de app.

## Fase 3 — transações candidatas: runtime como base, AST como fallback

**Revisado com o escopo v7.** O core 7 boota a app sem banco para gerar tipos
de rota (`codegen`); `fp:inventory` faz o mesmo e lê `router.toJSON()` —
rota, verbos, nome, **handler**. Exige `environment: 'web'` no boot para os
preloads de rota carregarem, e env presente. Sem app bootável, o parser de
`routes.ts` assume. O registry com tipos de body continua sendo Tuyau, opcional.

Exemplos antes do código:

- **runtime**: `router.toJSON()` produz os mesmos `EntryPoint` que o parser de
  AST na mesma fixture — os dois caminhos têm que concordar
- fallback `routes_ast`: arquivos de rota vêm dos `preloads` do `adonisrc.ts`
  seguindo imports (as quatro topologias); rota multi-linha; `.resource()` com
  `.only()`/`.apiOnly()`; controller por lazy import **ou** por mapa gerado
- DETs de entrada saem do **validator por AST** (`vine.object` recursivo,
  spread resolvido, array e objeto aninhado com regra registrada em
  `counting-decisions.md`); com Tuyau presente, o registry prevalece
- `controllers_map` resolve pelo caminho pontuado; **fixture com nome colidindo
  entre dois módulos** prova que resolve o certo
- `router.on(...).renderInertia(...)` vira `EntryPoint` sem handler, para a
  Fase 4 decidir

- cada `EntryPoint` carrega `identity` — `(verbo, padrão normalizado)` — como
  decidido em `counting-decisions.md` §5; fixture com a mesma rota sob `.as()`
  diferente prova que a identidade não depende do nome
- DETs por tipo composto seguem a tabela de `counting-decisions.md` §7; com
  Tuyau, registry e validator **têm que dar o mesmo número**

**Pronto quando:** as quatro fixtures de app produzem o mesmo conjunto de
`EntryPoint`.

## Fase 4 — `graph/call_graph`: o rastreamento

**A fase cara.** O spike mostrou que aqui mora a incerteza: a detecção de escrita
decide EE vs SE em ~40% das transações.

Exemplos antes do código:

- cada uma das 7 fixtures de `patterns/` alcança o data store e detecta a
  escrita — **inclusive `property_service`**: `@inject()` é o padrão oficial do
  AdonisJS, e fora da casa é a primeira coisa que precisa funcionar, não a última
- **mapeamento data store → classe de model**: o hook mora em `class Book
  extends BookSchema`, não no schema; sem achar a classe a partir do data store,
  a decisão sobre hooks é inexecutável
- **nível de método, não de arquivo**: fixture com service que tem um método de
  leitura e um de escrita; quem chama só o de leitura não vira EE
- `minimal_kysely`: a rota chega à escrita por `@inject()` no construtor →
  repositório em `src/` → `.insertInto()`; exige `PersistenceDetector` de Kysely
  e resolução por tipo
- `HandlerBehavior.scope` com `bodyHash` normalizado (sem whitespace/comentário),
  para o `fp:diff` — §5
- `edges/model_hook/`: a escrita no `@afterCreate` entra na transação que a
  disparou e soma FTR
- `edges/static_route/`: não alcança dado, não vira função, **e aparece no
  relatório de cobertura**
- `edges/vendor_route/`: idem, sem precisar de lista de exclusão
- chamada que nenhum resolvedor segue entra em `unresolved` com arquivo e linha

**Pronto quando:** cobertura de 100% nas fixtures e o relatório distingue "rota
legitimamente estática" de "rastreador falhou".

## Decisões tomadas antes da Fase 4

As três que a revisão sênior apontou como adiadas para onde não podiam ser
estão em `counting-decisions.md`, com a regra normativa:

1. **§5 Identidade entre versões** — ponto de entrada `(verbo, padrão)` para
   transação, tabela para dado; modificação por checksum de AST normalizado;
   fatores da AEP como default, SISP como preset. Base: OMG AEP 1.0.
2. **§6 DETs de saída** — campos dos data stores lidos, estreitados por
   `select`/transformer; divergência com o contador humano aceita e rastreada
   por `detSource`. Base: AFP §7.3.
3. **§7 DETs de tipos compostos** — tabela por forma; spread não resolvido
   conta 0 e entra em `unresolved`. Base: AFP §4 e §7.3, IFPUG grupo repetitivo.

Decidida também:

4. **Runtime: dentro do v1, só para rotas.** Boot sem banco é padrão do próprio
   core 7. Para dados, `schema:generate` exige banco — fonte é o arquivo
   versionado.

Fica uma de escopo:

5. **Orçamento de desempenho.** Fixtures têm 2 entidades; alvo real tem 48 e
   1100 arquivos. Grafo com hooks sobre ts-morph precisa caber em CI.

## Fase 5 — `albrecht`: as regras

Tabelas de complexidade já estão prontas e testadas.

Exemplos antes do código:

- ALI vs AIE pela regra de manutenção (AFP §6.5.4): escrita pela aplicação → ALI
- data store que nenhuma transação alcança → **não conta**
- EE vs SE pela regra de escrita (AFP §6.5.3); CE colapsado em SE
- `edges/package_table/`: tabela cuja escrita só nasce em `node_modules` é
  marcada como técnica e sai da contagem — aparecendo no relatório
- filtro de lookup e de convenção de nome, com os defaults do spec

**Pronto quando:** `CountResult` completo, com `Rationale` rastreável em cada
função.

## Fase 6 — validação

- **invariante de ouro**: `minimal_flat` e `minimal_modular` com contagem
  idêntica
- **benchmark Vazquez**: 56 PF de gabarito, tolerância declarada. O Ligeiro
  chegou a 52 (~7%) com divergências sistemáticas e explicáveis; o teste
  registra a tolerância e o motivo de cada divergência, em vez de esconder
- **fumaça em app real**: rodar contra aplicações de produção, fora da suíte,
  conferindo cobertura e ordem de grandeza

## Fase 7 — superfície de uso

`fp:inventory`, `fp:count`, `fp:explain`, depois `fp:diff` (inclusão /
alteração / exclusão, que é o que vira fatura) e `fp:calibrate`.

`fp:explain` merece teste próprio: a procedência é requisito, não enfeite, e
tem que sobreviver a refatoração.

## Fase 8 — métricas estatísticas

Sobre o mesmo inventário: acoplamento entre módulos, hotspots churn × complexidade,
conformidade de convenção. Só depois da APF de pé.

---

## Regras do processo

**Nenhuma fase termina vermelha.** A exceção é o benchmark Vazquez, pulado
explicitamente com o motivo até a Fase 6.

**Lacuna conhecida é declarada em teste, não em comentário.** O
`coverage.spec.ts` já faz isso: lista os padrões sem resolvedor e falha se
alguém adicionar fixture sem estratégia — ou se um padrão passar a ser resolvido
e a lista não for atualizada.

**Toda afirmação "universal" é testada fora da amostra que a gerou** antes de
virar dependência de desenho. A validação externa derrubou a premissa central
do plano em meio dia — barato porque veio antes da Fase 2.

**Toda armadilha vira regressão.** As três que já custaram caro — rota
multi-linha, colisão de nome de controller, `Job.dispatch` confundido com
service estático — têm teste que falha se voltarem.

## Ordem, e por quê

Fases 1–3 são baratas e produzem fato canônico a partir de artefato gerado.
Fase 4 é cara e é onde mora o risco. Fase 5 é quase trivial porque as tabelas já
existem.

Isso inverte a estimativa original, que achava a contagem difícil e a coleta
fácil. O spike mostrou o contrário: as tabelas IFPUG são aritmética, as funções
de dados quase se contam sozinhas, e **todo o problema real é o grafo**.

Uma conclusão do spike foi **retirada**: "a poda de ARs move o total só 2–7%".
Foi medida com o rastreamento quebrado (FTR médio 1,36). Quando o grafo
funcionar e o FTR subir, a poda pode ser o que mais mexe na complexidade. Será
reavaliada na Fase 4, com dado válido.
