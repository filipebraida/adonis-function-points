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

## Escopo do v1: AdonisJS 7 + Lucid 22

Decisão do autor após a validação externa: **o v1 mira core 7 com Lucid 22**.
Não é limitação de desenho — as costuras são gerais e a fixture Kysely fica como
sentinela — é sequência: um backend de ponta a ponta antes do segundo. Das 10
apps levantadas, 9 usam Lucid.

Fora do v1, detectado e reportado, nunca contado errado:

| detectado | comportamento |
|---|---|
| core 6 / Lucid 21 | "não suportado no v1" — sem schema gerado, sem codegen |
| ORM ≠ Lucid (Kysely…) | "ORM não suportado"; costura provada pela fixture pulada |
| core 5 | `layout: unknown`, 0 aliases — fora de escopo |

O que o escopo v7 devolve ao jogo — com as precondições reais, lidas no código
do framework:

| artefato | como obter | precondição |
|---|---|---|
| rotas → handler | **runtime**: bootar a app (`environment: 'web'`, para os preloads de rota carregarem) e ler `router.toJSON()` — é exatamente o que `node ace codegen` faz | app bootável: deps instaladas, env presente; **sem banco** |
| `database/schema.ts` | versionado, ou `node ace schema:generate` | o gerador **introspecta o banco vivo** — sem conexão, tem que estar versionado |
| DETs de entrada | validator por AST; registry do Tuyau quando existir | — |
| grafo de chamadas | AST | — |

## Ordem das fontes

**Revisada após a validação externa**
([`../research/external-validation.md`](../research/external-validation.md)):
a ordem original ("gerado primeiro") só vale para AdonisJS 7 + Lucid 22 + Tuyau.
Os starter kits oficiais estão em core 6.18 / Lucid 21.6, sem nenhum gerado.

No escopo v7, por fato:

| fato | fonte primária | fallback | confiabilidade |
|---|---|---|---|
| rotas, verbos, handler | **runtime** (`router.toJSON()` após boot sem banco) | parser de `routes.ts` via `preloads` | exata / heurística |
| funções de dados, colunas | **`database/schema.ts`** (Lucid 22) | model por AST seguindo herança | canônica / heurística |
| DETs de entrada | registry **Tuyau**, se houver | validator por AST | canônica / boa |
| grafo, escrita, FTR | **AST** | — | heurística controlada |
| agrupamento | convenção de pasta | — | metadado |

**Runtime entrou no v1, só para rotas.** O core 7 prova que bootar sem banco é
o padrão do próprio framework (`codegen` faz isso). Nada de runtime para dados:
`schema:generate` precisa do banco, então o arquivo versionado é a fonte.

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
.deleteFrom()`.

O v1 suporta **apenas Lucid**: Kysely é detectado e reportado como não
suportado, com a fixture sentinela pulada no lugar. A costura para um segundo
ORM existe — a detecção de persistência está isolada em
`src/inventory/detectors/` — mas ainda não é ponto de extensão público, porque
nada no pipeline consome um detector registrado. Ver "Extensibilidade".

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
├── types.ts                  modelo de domínio compartilhado
├── pipeline.ts               analyze(root, options) -> { inventory, count }
├── define_config.ts          FunctionPointsConfig
├── inventory/
│   ├── app_context.ts        descobre a app: imports do package.json,
│   │                         artefatos gerados, layout, raízes de varredura
│   ├── sources/              fatos, por ARTEFATO (não por pasta)
│   │   ├── data_stores.ts        models seguindo a cadeia de herança;
│   │   │                         schema gerado quando existe
│   │   └── routes_ast.ts         rotas dos preloads, lazy import ou mapa
│   ├── graph/
│   │   └── call_graph.ts     transação -> dados, em nível de MÉTODO;
│   │                         DETs de entrada pelos validators; cobertura
│   ├── resolvers/            como seguir cada padrão de código
│   └── detectors/lucid.ts    o que é leitura/escrita
├── albrecht/
│   ├── tables.ts             tabelas de complexidade IFPUG
│   ├── data_functions.ts     ALI vs AIE, DET/RET
│   ├── transactional_functions.ts   EE vs SE, DET/FTR
│   ├── technical_filter.ts   AFP 6.5.2.1.1 + origem da escrita
│   ├── counter.ts            a contagem
│   ├── diff.ts               inclusão / alteração / exclusão (AEP)
│   └── calibration.ts        viés contra contagem manual
├── metrics/structure.ts      acoplamento, densidade, conformidade
└── reporters/table.ts        os relatórios de `fp:*`
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

**Um** ponto de extensão público, em `src/inventory/resolvers/types.ts`:

- **`CallResolver`** — como seguir de um call site ao próximo corpo. Inclui
  resolução **por tipo do parâmetro do construtor** (`@inject()` com
  `constructor(private q: GetArticleQuery)`), que em apps com DI é o *único*
  caminho da rota à escrita.

Estratégias do usuário rodam **antes** das embutidas. **A primeira que
reivindica, vence** — formas sintaticamente idênticas têm significados
diferentes (`Job.dispatch(p)`, `Service.create(p)` e `Model.find(p)` são todas
`Identificador.metodo(args)`), e só a ordem as separa.

Coletor de repositórios, coletor de pontos de entrada e detector de persistência
continuam sendo **costuras internas** — cada um mora num módulo próprio e pode
virar ponto de extensão quando houver um segundo caso real. Enquanto o pipeline
não consumir um registrado, a interface não é exportada: tipo público que o
código não honra é a mesma promessa vazia que configuração sem efeito.

### Transação não é sinônimo de rota HTTP

Comando ace que importa planilha e job agendado que sincroniza com sistema
externo são funções transacionais pelo IFPUG. No v1 só rotas HTTP são coletadas;
é a costura de coleta de pontos de entrada que abre esse caminho.

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
