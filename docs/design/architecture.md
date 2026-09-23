# Arquitetura

Revisada após o levantamento de 6 aplicações AdonisJS de produção
([`../research/adonisjs-variation.md`](../research/adonisjs-variation.md)). A
versão anterior procurava artefatos por convenção de pasta e teria contado zero
em duas das seis apps.

## A tese

**O grafo transação → funções de dados é a espinha da contagem. Todo o resto é
filtro de borda.**

Isso não é preferência de desenho — caiu do AFP. Três das quatro decisões de
borda em [`counting-decisions.md`](counting-decisions.md) se resolvem pela mesma
regra: rota estática não conta porque não alcança dado; rota de pacote terceiro
idem; hook de model conta porque está no caminho; tabela órfã não conta porque
ninguém a alcança.

Consequência prática: a qualidade do pacote é a qualidade desse rastreamento. É
onde o esforço vai.

## Ordem das fontes

**Revisada após a validação externa**
([`../research/external-validation.md`](../research/external-validation.md)):
a ordem original ("gerado primeiro") só vale para AdonisJS 7 + Lucid 22 + Tuyau.
Os starter kits oficiais estão em core 6.18 / Lucid 21.6, sem nenhum gerado.

| # | fonte | papel | confiabilidade |
|---|---|---|---|
| 1 | **AST** — validators, models com cadeia de herança, `routes.ts` listados nos `preloads` do `adonisrc.ts` | **base**: v6 e v7, com ou sem Tuyau | heurística controlada |
| 2 | **artefato gerado** — schema Lucid 22, codegen core 7, registry Tuyau | **upgrade de precisão** onde existe; em v7, regenerável sob demanda | canônica |
| 3 | **runtime** | decisão pendente: dentro ou fora do v1 | exata, exige bootar |
| 4 | **convenção de pasta** | agrupamento de relatório | metadado |

O relatório diz **qual fonte produziu cada fato**. Uma contagem feita só por
AST e outra com schema gerado não são equivalentes, e o número tem que carregar
essa proveniência.

**Convenção de pasta nunca é usada para encontrar coisa.** Um pacote que procura
models em `app/**/models/` conta zero numa das apps levantadas, onde 35 arquivos
de model não estendem `BaseModel` do Lucid — e é por isso que o parser de model
por AST tem que **seguir a cadeia de herança** (`extends compose(Base, Mixin)`),
não olhar só o arquivo.

### Os artefatos gerados, e quem os gera

| artefato | gerador | desde |
|---|---|---|
| `database/schema.ts` — `*Schema` com `$columns` canônico | `@adonisjs/lucid` oficial, `migration:run` (padrão) ou `schema:generate` | Lucid 22 |
| `.adonisjs/server/controllers.ts`, `routes.d.ts` (nome + params, **sem body**) | `@adonisjs/core` `codegen` | core 7 |
| `.adonisjs/client/registry/schema.d.ts` — rotas **com tipos de body/query** | `@tuyau/core`, terceiro, opcional | — |

Quando presentes, resolvem sozinhos duas variações caras: estilos heterogêneos
de model, e colunas que **pacotes** acrescentam via migration própria. Em v7 o
pacote deve oferecer regenerar antes de contar, em vez de confiar em arquivo
possivelmente obsoleto.

### Lucid não é dado

O `romainlanz.com` (core team) usa **Kysely + kysely-codegen**, sem Lucid: o
schema gerado é `types/db.ts` (`interface Articles { … }` por tabela), as
migrations usam a DSL do Kysely, e a escrita é `.insertInto()/.updateTable()/
.deleteFrom()`. `DataStoreCollector` e `PersistenceDetector` são pontos de
extensão porque uma app do core team precisa deles — não por hipótese. O v1
suporta **Lucid e Kysely**; o relatório diz qual detector produziu cada acesso.

### A raiz de varredura não é `app/`

Na mesma app, os repositórios — onde mora 100% da escrita — ficam em
`src/<módulo>/repositories/`, fora de `app/`. A raiz de varredura é **o
conjunto de diretórios alcançáveis pelos aliases do `package.json`**
(`app/`, `src/`, `shared/`, `types/`…), e módulos podem ser aninhados
(`app/admin/taxonomies/`). `moduleOf()` devolve o caminho de módulo completo,
não o primeiro segmento.

## Camadas

```
src/inventory/   fatos crus — NÃO conhece APF
src/albrecht/    regras IFPUG/AFP sobre o inventário
```

**Regra inegociável:** `src/inventory/**` nunca importa de `src/albrecht/**`. O
inventário não sabe o que é um ALI. É isso que permite extrair a camada para um
pacote próprio se as métricas estatísticas crescerem.

```
src/
├── inventory/
│   ├── app_context.ts        descobre a app: imports do package.json,
│   │                         artefatos gerados, layout
│   ├── sources/              fatos, por ARTEFATO (não por pasta)
│   │   ├── routes_ast.ts         BASE: rotas dos preloads, lazy import ou mapa
│   │   ├── models_ast.ts         BASE: models seguindo a cadeia de herança
│   │   ├── validators_ast.ts     BASE: DETs de entrada
│   │   ├── route_registry.ts     upgrade (Tuyau): DETs de entrada tipados
│   │   ├── controllers_map.ts    upgrade (core 7): nome -> arquivo
│   │   ├── data_schema.ts        upgrade (Lucid 22): colunas canônicas
│   │   └── model_hooks.ts        hooks, que entram no caminho da transação
│   ├── graph/
│   │   ├── call_graph.ts     transação -> dados, em nível de MÉTODO
│   │   └── coverage.ts       o que não foi resolvido, exigido pelo AFP
│   ├── resolvers/            como seguir cada padrão de código
│   └── detectors/            o que é leitura/escrita (lucid, query builder)
└── albrecht/
    ├── tables.ts             tabelas de complexidade IFPUG
    ├── data_functions.ts     ALI vs AIE, DET/RET
    ├── transactional_functions.ts   EE vs SE, DET/FTR
    ├── technical_filter.ts   AFP 6.5.2.1.1 + origem da escrita
    └── counter.ts
```

## Descoberta no lugar de configuração

`AppContext` descobre o que precisa em vez de perguntar:

- **aliases `#`** — lidos do `imports` do `package.json`, nunca deduzidos:
  existem duas convenções incompatíveis em uso (`#models/*` por tipo,
  `#collect/*` por módulo);
- **artefatos gerados** — localizados pelo cabeçalho de geração e pela forma das
  classes, não pelo caminho;
- **layout** — detectado, e usado só para agrupar relatório.

Sobra como configuração apenas o que é **decisão de negócio**, que nenhuma
heurística deveria tomar: a fronteira da aplicação, quais repositórios são
mantidos externamente (AIE), e overrides com justificativa obrigatória.

## Extensibilidade é requisito

AdonisJS não impõe organização. Medido nas 6 apps, a escrita se espalha assim:

| app | controllers | services | actions | queries | jobs | models |
|---|---|---|---|---|---|---|
| A | 0 | 3 | 15 | 0 | 0 | 3 |
| B | 14 | 16 | 92 | 0 | 0 | 0 |
| C | 27 | 154 | 131 | 8 | 63 | 5 |
| D | 0 | 1 | 135 | 0 | 1 | 1 |

Nenhuma usa menos de 4 tipos de artefato. O rastreamento não pode privilegiar
nenhum — segue o grafo onde ele for, e o tipo de artefato é só metadado.

Quatro pontos de extensão em `src/inventory/resolvers/types.ts`:

- **`CallResolver`** — como seguir de um call site ao próximo corpo. Inclui
  resolução **por tipo do parâmetro do construtor** (`@inject()` com
  `constructor(private q: GetArticleQuery)`), que em apps com DI é o *único*
  caminho da rota à escrita
- **`PersistenceDetector`** — o que é leitura/escrita (trocar o ORM troca isto,
  não o grafo)
- **`DataStoreCollector`** — de onde saem candidatos a ALI/AIE
- **`EntryPointCollector`** — de onde saem candidatos a EE/SE/CE

Estratégias do usuário rodam **antes** das embutidas. **A primeira que
reivindica, vence** — formas sintaticamente idênticas têm significados
diferentes (`Job.dispatch(p)`, `Service.create(p)` e `Model.find(p)` são todas
`Identificador.metodo(args)`), e só a ordem as separa.

### Transação não é sinônimo de rota HTTP

Comando ace que importa planilha e job agendado que sincroniza com sistema
externo são funções transacionais pelo IFPUG. Cada um é um
`EntryPointCollector`.

## Rastreabilidade é requisito

Toda função contada carrega `Rationale`: regra aplicada, origem de cada DET e
FTR, caminho no grafo, e overrides com justificativa obrigatória. É o que
`fp:explain` imprime. Se PF vira fatura, alguém vai contestar um número, e um
número sem procedência é indefensável.

O ruleset é versionado e sai em todo relatório: contagens só são comparáveis se
as regras não mudaram no meio.

## Dizer "não sei" é melhor que errar em silêncio

Chamada que nenhum resolvedor segue entra em `unresolved` e conta na cobertura.
Abaixo de `minCoverage`, a contagem **falha**.

O AFP não trata isso como opcional:

> "If the transaction execution depends on code that is unknown or unavailable
> to the automated tool, the code end point shall be cataloged and listed in the
> generated report in order to detect and quantify the missing patterns and
> libraries." — AFP §6.5.3

Isso importa ainda mais depois da decisão sobre rotas estáticas: "não alcançou
dado nenhum" significa *ou* que a rota é legitimamente estática, *ou* que o
rastreador falhou. As duas têm que ser distinguíveis no relatório.

## Documentos irmãos

- [`../research/external-validation.md`](../research/external-validation.md) —
  a tese testada fora da amostra: quem gera cada artefato e a matriz de suporte
- [`../research/adonisjs-variation.md`](../research/adonisjs-variation.md) — o
  que varia entre apps e o que não varia
- [`../research/spike-findings.md`](../research/spike-findings.md) — medições do
  spike e armadilhas já pagas
- [`counting-decisions.md`](counting-decisions.md) — casos de borda, com a regra
  do AFP que sustenta cada um
- [`resolvers.md`](resolvers.md) — catálogo de padrões de código
- [`implementation-plan.md`](implementation-plan.md) — o plano, guiado por testes
