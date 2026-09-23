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

| # | fonte | o que entrega | confiabilidade |
|---|---|---|---|
| 1 | **artefato gerado** | rotas, verbos, DETs de entrada, colunas canônicas | canônica |
| 2 | **runtime** | `router.toJSON()`, metadados do Lucid | exata, exige bootar |
| 3 | **AST** | grafo de chamadas, detecção de escrita | heurística |
| 4 | **convenção de pasta** | agrupamento de relatório | metadado |

**Convenção de pasta nunca é usada para encontrar coisa.** Um pacote que procura
models em `app/**/models/` conta zero numa das apps levantadas, onde 35 arquivos
de model não estendem `BaseModel` do Lucid e só 3 têm `@column`.

### Os dois artefatos gerados

Presentes nas 6 aplicações, independentes de layout:

**`.adonisjs/client/registry/schema.d.ts`** — 157 a 164 rotas por app, com nome,
verbos, padrão e os tipos de `body`/`query` inferidos do VineJS. Ou seja: as
transações candidatas **e** seus DETs de entrada, de graça. Acompanhado de
`.adonisjs/server/controllers.ts` (nome → arquivo do controller).

**`database/schema.ts`** — gerado das migrations, classes `<Nome>Schema` com
`static $columns` canônico. É a fonte certa de DETs e resolve sozinha duas
variações que quebram um parser de models: estilos de definição heterogêneos, e
colunas que **pacotes** acrescentam via migration própria — que aparecem ali sem
o contador precisar saber que aquele pacote existe.

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
│   │   ├── route_registry.ts     registry gerado -> transações + DETs entrada
│   │   ├── controllers_map.ts    mapa gerado nome -> arquivo
│   │   ├── data_schema.ts        schema gerado -> data stores + DETs
│   │   ├── routes_ast.ts         fallback quando não há registry
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

- **`CallResolver`** — como seguir de um call site ao próximo corpo
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

- [`../research/adonisjs-variation.md`](../research/adonisjs-variation.md) — o
  que varia entre apps e o que não varia
- [`../research/spike-findings.md`](../research/spike-findings.md) — medições do
  spike e armadilhas já pagas
- [`counting-decisions.md`](counting-decisions.md) — casos de borda, com a regra
  do AFP que sustenta cada um
- [`resolvers.md`](resolvers.md) — catálogo de padrões de código
- [`implementation-plan.md`](implementation-plan.md) — o plano, guiado por testes
