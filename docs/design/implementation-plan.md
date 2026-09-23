# Plano de implementação

Reescrito do zero depois de três rodadas de emenda, que deixaram o documento com
contradições reais — `minimal_v6` listada ao mesmo tempo como fora de escopo e
como fixture ativa, `canRegenerate` sobrevivendo à descoberta de que
`schema:generate` precisa de banco. O histórico do que mudou está no fim.

## Escopo do v1

**AdonisJS 7 + Lucid 22.** Um backend de ponta a ponta antes do segundo — das 10
aplicações levantadas, 9 usam Lucid.

Fora do escopo é **detectado e reportado**, nunca contado errado: core 6 /
Lucid 21, ORM diferente de Lucid, core 5. As costuras continuam gerais, e a
fixture Kysely fica pulada como sentinela delas.

## Estado atual

| | |
|---|---|
| feito | scaffold; `AppContext` (aliases, gerados, layout); tabelas IFPUG; 5 resolvedores de chamada; 42 testes |
| falta | tudo que produz inventário e contagem |

## Método: exemplo primeiro

Cada passo começa por uma fixture com resultado conhecido; o código vem depois.

A razão é específica deste pacote: ele produz um número que vira fatura, e a
única forma de saber que está certo é comparar com um caso de resposta
conhecida. Fixture escrita depois do código testa o que o código faz, não o que
deveria fazer.

## A invariante de ouro

> **A mesma aplicação lógica, escrita de formas diferentes, tem que produzir
> contagem idêntica.**

É o teste mais importante do projeto, escrito antes do primeiro coletor e
destravado fase por fase — hoje com a Fase 1 ativa e as Fases 2, 3 e 5 puladas.

**Ressalva honesta:** `minimal_flat` e `minimal_modular` foram escritas pela
mesma mão, ao mesmo tempo, e compartilham registry e schema byte a byte. São
regressão, não generalização. Quem testa generalização é `minimal_nogen` — a
mesma app sem nenhum gerado versionado, o que força o caminho por AST.

## Fixtures

```
tests/fixtures/
├── apps/
│   ├── minimal_flat/        MVC plano, com gerados                [feito]
│   ├── minimal_modular/     módulo por domínio, com gerados       [feito]
│   ├── no_generated/        ausência reportável                   [feito]
│   ├── overlapping_aliases/ especificidade de alias               [feito]
│   ├── minimal_nogen/       v7 SEM gerados versionados: prova o fallback por AST
│   ├── minimal_kysely/      SENTINELA, pulada no v1: prova que outro ORM entra
│   │                        mexendo só em sources/ e detectors/
│   └── vazquez/             benchmark público, gabarito 56 PF
├── patterns/                onde mora a lógica            [7 fixtures, feito]
├── models/                  direct · generated_schema · composed_mixin
└── edges/                   static_route · vendor_route · model_hook · package_table
```

Fixtures são estáticas — o ts-morph parseia a árvore sem instalar nem bootar.
Exceção deliberada: a Fase 3 precisa de **uma** app bootável para exercitar o
caminho de runtime.

---

## Fase 1 — `AppContext`: descoberta *(parcial)*

Já feito: aliases lidos do `package.json` com regra de especificidade; gerados
achados pelo que são e não por onde estão; layout por peso de evidência;
ausência reportada em vez de assumida.

Falta:

- **`routeFiles`** — dos `preloads` do `adonisrc.ts`, seguindo os `import`
  estáticos que eles alcançam. Quatro topologias encontradas nas apps reais:
  arquivo único, um por módulo, diretório `start/routes/*.ts`, e um hub que só
  importa os arquivos de módulo.
- **`scanRoots`** — diretórios alcançáveis pelos aliases, não apenas `app/`.
  Numa app externa, 100% da escrita mora em `src/`.
- **`moduleOf()` com módulo aninhado** (`admin/taxonomies`).
- **`framework: { core, lucid, orm }`** — escolhe a estratégia, vai para o
  relatório, e fora do escopo v1 faz o pacote reportar em vez de contar.

**Pronto quando:** `minimal_flat`, `minimal_modular` e `minimal_nogen` produzem
`AppContext` equivalente, diferindo só em `layout` e `generated`.

## Fase 2 — funções de dados

A metade confiável da contagem (~24% do total). A invariante de ordem do
`ResolverContext` exige data stores prontos antes de qualquer análise de handler.

Duas fontes, com precedência:

1. **`database/schema.ts` versionado** (Lucid 22) — canônico. Note que
   `schema:generate` **introspecta o banco vivo**, então não há como regenerar
   em CI sem conexão: a fonte é o arquivo versionado.
2. **Model por AST**, seguindo a cadeia de herança (`extends UserSchema`,
   `extends compose(Base, Auditable)`). Olhar só o arquivo zera uma app inteira
   — numa das levantadas há 35 models e zero `extends BaseModel`.

Exemplos primeiro:

- os três estilos em `models/` produzem **as mesmas colunas** por AST
- com schema gerado presente, `static $columns` prevalece e o `DataStore`
  registra de qual fonte veio
- coluna acrescentada por migration de pacote aparece; propriedade transiente não
- `minimal_nogen` chega ao mesmo `DataStore[]` das outras duas
- `DataStore` carrega `table` e os nomes dos DETs, exigidos pela identidade (§5)

**Pronto quando:** `DataStore[]` idêntico entre as três fixtures.

## Fase 3 — pontos de entrada

**Runtime como fonte primária.** O core 7 já boota a app sem banco para gerar
tipos de rota (`node ace codegen`); o `fp:inventory` faz o mesmo e lê
`router.toJSON()`, que devolve `{ pattern, name, handler, methods, middleware }`.

Precondições: app bootável, `environment: 'web'` (sem isso os preloads de rota
não carregam) e env presente. Faltando qualquer uma, o parser de `routes.ts`
assume.

Exemplos primeiro:

- runtime e AST produzem **os mesmos `EntryPoint`** na mesma fixture — os dois
  caminhos têm que concordar
- fallback por AST: rota multi-linha, `.resource()` com `.only()`/`.apiOnly()`,
  controller por lazy import **ou** por mapa gerado
- `controllers_map` resolve pelo caminho pontuado; fixture com nome colidindo
  entre módulos prova que resolve o certo
- `EntryPoint.identity` = `(verbo, padrão normalizado)` (§5); fixture com a mesma
  rota sob `.as()` diferente prova que a identidade não depende do nome
- DETs de entrada pela tabela de tipos compostos (§7); com Tuyau presente,
  registry e validator **têm que dar o mesmo número**
- `router.on(...).renderInertia(...)` vira `EntryPoint` sem handler, para a
  Fase 4 decidir

**Pronto quando:** as três fixtures produzem o mesmo conjunto de `EntryPoint`.

## Fase 4 — o grafo *(a fase cara)*

É onde mora a incerteza: a detecção de escrita decide EE vs SE em ~40% das
transações, e a qualidade do pacote é a qualidade deste rastreamento.

Exemplos primeiro:

- as 7 fixtures de `patterns/` alcançam o data store e detectam a escrita —
  **inclusive `property_service`**: `@inject()` é o padrão oficial do AdonisJS e,
  numa app com DI, é o único caminho da rota até a escrita
- **nível de método, não de arquivo**: fixture com um service que tem um método
  de leitura e outro de escrita; quem chama só o de leitura não vira EE
- **mapeamento data store → classe de model**: o hook mora em `class Book extends
  BookSchema`, não no schema; sem esse mapa a decisão §3 é inexecutável
- `edges/model_hook/`: escrita em `@afterCreate` entra na transação que a
  disparou e soma FTR
- `edges/static_route/` e `edges/vendor_route/`: não alcançam dado, não contam,
  **e aparecem na cobertura** — sem precisar de lista de exclusão
- `HandlerBehavior.scope` com `bodyHash` de AST normalizado (sem whitespace nem
  comentário), exigido pelo `fp:diff` (§5)
- chamada que nenhum resolvedor segue entra em `unresolved`, com arquivo e linha

**Pronto quando:** cobertura de 100% nas fixtures, e o relatório distingue "rota
legitimamente estática" de "rastreador falhou".

**Medir aqui:** a sensibilidade à poda de ARs. A conclusão do spike — "move só
2–7%" — foi obtida com o rastreamento quebrado, FTR médio 1,36, e não se
sustenta. Refazer com o grafo funcionando.

## Fase 5 — `albrecht`: as regras

As tabelas de complexidade já estão prontas e testadas.

Exemplos primeiro:

- ALI vs AIE pela regra de manutenção (AFP §6.5.4): escrita pela aplicação → ALI
- data store que nenhuma transação alcança → **não conta**
- EE vs SE pela regra de escrita (AFP §6.5.3); CE colapsado em SE
- DETs de saída pela §6, com `detSource` registrado em cada função
- `edges/package_table/`: tabela cuja escrita só nasce em `node_modules` sai da
  contagem, marcada como técnica no relatório
- filtro de lookup e de convenção de nome, com os defaults do próprio spec

**Pronto quando:** `CountResult` completo, com `Rationale` rastreável em cada
função.

## Fase 6 — validação

- **invariante de ouro**: as três fixtures com contagem idêntica
- **benchmark Vazquez**: gabarito de 56 PF, tolerância declarada. O Ligeiro
  chegou a 52 (~7%) com divergências sistemáticas; o teste registra a tolerância
  e o motivo de cada divergência em vez de escondê-las
- **fumaça em app real**, fora da suíte: cobertura e ordem de grandeza

## Fase 7 — superfície de uso

`fp:inventory`, `fp:count`, `fp:explain`, depois `fp:diff` e `fp:calibrate`.

`fp:diff` é o que vira fatura: inclusão / alteração / exclusão, com os fatores da
AEP por default e SISP como preset. `fp:explain` merece teste próprio — a
procedência é requisito, não enfeite, e tem que sobreviver a refatoração.

## Fase 8 — métricas estatísticas

Sobre o mesmo inventário: acoplamento entre módulos, hotspots churn ×
complexidade, conformidade de convenção. Só depois da APF de pé.

---

## Regras de processo

**Nenhuma fase termina vermelha.** Exceções declaradas com o motivo: o benchmark
Vazquez e a sentinela Kysely.

**Toda afirmação "universal" é testada fora da amostra que a gerou** antes de
virar dependência de desenho. A validação externa derrubou a premissa central do
plano em meio dia — barato porque veio antes da Fase 2.

**Lacuna conhecida é declarada em teste, não em comentário.** O
`coverage.spec.ts` lista os padrões sem resolvedor e falha nos dois sentidos: se
alguém adiciona fixture sem estratégia, ou se um padrão passa a ser resolvido sem
a lista ser atualizada.

**Toda armadilha vira regressão.** As que já custaram caro têm teste: rota
multi-linha, colisão de nome de controller, `Job.dispatch` confundido com service
estático, alias específico perdendo para o genérico.

**Teste verde é suspeito até provar que tem dentes.** A regra de especificidade
de alias passou num teste que não a exercitava; só a mutação revelou.

**Documento muda no mesmo commit que o invalida.** Este plano precisou ser
reescrito porque acumulou emendas até se contradizer — sinal de que a regra não
estava sendo seguida.

## Pendência de escopo

**Orçamento de desempenho.** As fixtures têm 2 entidades; o alvo real tem 48 e
~1100 arquivos. O grafo com hooks sobre ts-morph pode não caber em CI. Medir na
Fase 4 contra a app real e fixar o teto antes da Fase 7.

## Ordem, e por quê

Fases 1–3 são baratas e produzem fato canônico. A Fase 4 é cara e concentra o
risco. A Fase 5 é quase aritmética, porque as tabelas já existem.

Isso inverte a estimativa original, que achava a contagem difícil e a coleta
fácil. O spike mostrou o contrário: as tabelas IFPUG são aritmética, as funções
de dados quase se contam sozinhas, e **todo o problema real é o grafo**.

## Histórico

- **Levantamento de 6 apps** → convenção de pasta sai do caminho crítico; o
  desenho passa a se apoiar em artefatos gerados.
- **Validação externa, 5 apps de terceiros** → os gerados não são universais: só
  existem em core 7 + Lucid 22 + Tuyau. AST vira base, gerados viram upgrade.
- **Decisões §5–§7** (identidade entre versões, DETs de saída, tipos compostos)
  → resolvidas com AEP e AFP; restringem o formato do inventário desde a Fase 2.
- **Escopo v1 em v7 + Lucid 22** → runtime entra para rotas, já que o próprio
  `codegen` prova que boot sem banco é viável; `schema:generate` exige banco,
  então os dados vêm do arquivo versionado.
