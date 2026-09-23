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
| feito | scaffold; **Fases 1 e 2 completas** (`AppContext` + `collectDataStores`); tabelas IFPUG; 5 resolvedores de chamada; 72 testes |
| falta | Fases 3–8: pontos de entrada, grafo, contagem |

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
│   ├── minimal_kysely/      placeholder pulado no v1; só vira prova da costura
│   │                        quando for despulado com um segundo ORM de verdade
│   └── vazquez/             benchmark público, gabarito 56 PF
├── patterns/                onde mora a lógica            [7 fixtures, feito]
├── models/                  direct · generated_schema · composed_mixin  [a criar]
└── edges/                   static_route · vendor_route · model_hook ·
                             package_table                              [a criar]

tests/app/                   UMA app AdonisJS 7 bootável (config, providers,
                             sqlite), para o único teste de runtime — Fase 3
```

Fixtures são estáticas — o ts-morph parseia a árvore sem instalar nem bootar.
A única exceção é `tests/app/`: bootável, lenta, roda num grupo de integração
separado da suíte unitária.

---

## Fase 1 — `AppContext`: descoberta ✅

Entregue: aliases com regra de especificidade; gerados achados pelo que são e
não por onde estão; layout por peso de evidência; ausência reportada em vez de
assumida; `routeFiles` a partir dos `preloads` seguindo os `import` estáticos;
`scanRoots` pelos alvos dos aliases, com aninhados colapsados e não-aplicação
excluída; `framework` com versões, ORM e `supported`; `moduleOf` aninhado.

Validado contra 7 aplicações reais: a contagem de arquivos de rota bate com a
manual em todas (`app C` 12, `app B` 14, `app D` 7, `app A` 1), o hub de
rotas do `romainlanz.com` é seguido, e as duas apps fora de escopo (core 6, e
Kysely sem Lucid) saem como `supported: false`.

Três decisões que só a implementação revelou:

- **`moduleOf` não pode depender de `scanRoots`.** Em layout plano não existe
  alias `#app/*`, então as raízes acabam sendo as próprias pastas de tipo
  (`app/models`) e o módulo viraria "models". Deriva do caminho relativo à raiz.
- **Hub de rotas é passo de travessia, não arquivo de rota.** Um arquivo que só
  reexporta não tem `router.` para parsear. A primeira versão do teste afirmava
  o contrário — o teste é que estava errado.
- **Raízes que não são código de aplicação ficam de fora.** Há `.insertInto()`
  em `tests/factories/` numa app real; varrer isso contaria escrita de teste
  como função da aplicação. Default conservador, sobrescrevível por `boundary`.

## Fase 2 — funções de dados ✅

Entregue: `collectDataStores` percorre a **cadeia de herança** a partir de cada
classe da aplicação e a reconhece como repositório de dados quando a cadeia
chega ao `BaseModel` do Lucid. Colunas, chave primária, tabela física,
subgrupos de composição e procedência por atributo.

Validado contra 5 aplicações de produção, com contagem **exata** em todas:
`app A` 35, `app C` 32, `app B` 30, `app D` 13, `starter-kit` 4. Entre 41
e 385 ms por aplicação.

Quatro correções que só a app real revelou — nenhuma fixture as teria pego:

- **Base própria derrubava o model inteiro.** 17 dos 34 models de uma app
  estendem um `BaseModel` local. O código via o nome, não batia com o
  specifier do Lucid e seguia adiante sem resolver.
- **Import com alias.** Essa base faz `import { BaseModel as AdonisBaseModel }`.
  Comparar o nome do identificador local é errado por construção: o que
  identifica é o par (specifier, nome exportado na origem).
- **Classe base virava repositório fantasma.** Regra: classe usada como
  ancestral por outro model é base, não repositório — sem tabela, não conta.
- **Pendência de toda classe da app.** Controllers e exceptions que estendem
  algo de pacote entravam no relatório. Passou a ser por cadeia, e só sobe se a
  cadeia for mesmo de model: de ~100 pendências para 2–11 por app.

E uma decisão sobre relatório: a **razão** da pendência tem que ser exata. Uma
fábrica de mixin local (`compose(Base, withRoles())`) não é "fora da
aplicação" — dizer isso mandaria o usuário procurar no lugar errado.

**Lacuna conhecida, declarada em teste:** fábrica de mixin não é resolvida; a
coluna que ela acrescenta só existe na classe retornada pela função.

## Fase 3 — pontos de entrada

**Ordem de construção: AST primeiro, runtime depois.** As fixtures não bootam,
e a invariante de ouro depende de `minimal_nogen`, que só existe por AST. O
parser de `routes.ts` é o que se constrói e se testa primeiro — chamá-lo de
"fallback" descreve a precedência em produção, não a sequência de trabalho.

**Em produção, runtime é a fonte primária.** O core 7 já boota a app sem banco
para gerar tipos de rota (`node ace codegen`); o `fp:inventory` faz o mesmo e lê
`router.toJSON()`, que devolve `{ pattern, name, handler, methods, middleware }`.
Precondições: app bootável, `environment: 'web'` (sem isso os preloads de rota
não carregam) e env presente. Faltando qualquer uma, o parser assume e o
relatório diz qual fonte foi usada.

**Regra de conflito, decidida:** quando os dois estão disponíveis e divergem,
**runtime vence** — é o router real — e cada divergência é listada no relatório
como `route-source-mismatch`, porque significa ou rota registrada por código que
o parser não entende, ou parser com bug. As duas coisas interessam.

**O teste de runtime é um só**, de integração, contra `tests/app/` — uma app
AdonisJS 7 mínima e bootável, com `config/`, providers e sqlite. Roda num grupo
separado da suíte unitária, porque é lento.

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

**A decisão mais cara do projeto mora aqui, e tem que ser tomada às claras:**
resolver `constructor(private q: GetArticleQuery)` exige o **type checker**. O
`Project` do ts-morph deixa de ser leve (`skipFileDependencyResolution`) e passa
a carregar o `tsconfig` da app e os tipos de `node_modules`. Isso multiplica o
custo de toda a análise. Por isso:

- o grafo nasce **sintático** (todos os resolvedores exceto `property-service`),
  e o desempenho é medido na app real da casa *antes* de o type checker entrar;
- `property-service` entra em seguida, e o custo é medido de novo **no mesmo
  dia**. Se estourar o teto, a alternativa é resolução por convenção de nome do
  parâmetro (`private users: UserService` → `#…/user_service`) com o type
  checker como opção — não o contrário.

**Fronteira de `node_modules`, decidida:** o grafo **não entra** em código de
pacote, com uma exceção estreita: hooks e mixins registrados em models da
aplicação (`compose(Base, Auditable)`) são seguidos **um nível** para dentro do
pacote, e cada passo assim é marcado `vendor: true`. É o que torna executável o
filtro técnico da decisão §4 ("escrita que nasce só em `node_modules`") sem
transformar o pacote num analisador de dependências.

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

**Pronto quando:** cobertura de 100% nas fixtures — que é tautológico, as
fixtures são escritas para resolver — **e cobertura ≥ 85% em duas apps reais da
casa**, uma de cada layout. 85% é o `minCoverage` default: se o pacote não
atinge o próprio limiar nas apps para as quais foi desenhado, o limiar está
errado ou o grafo está. O relatório distingue "rota legitimamente estática" de
"rastreador falhou".

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
  e o motivo de cada divergência em vez de escondê-las.
  **A fixture é escrita a partir da especificação dos casos de uso e congelada
  em commit próprio antes de o contador existir**, com as escolhas de
  transcrição documentadas (quais campos viram validator, o que vira transformer).
  Sem isso, a independência do benchmark é ilusória: nada impediria afinar a
  fixture até bater 56.
- **fumaça em app real**, fora da suíte: cobertura e ordem de grandeza

## Fase 7 — superfície de uso

`fp:inventory`, `fp:count`, `fp:explain`, depois `fp:diff` e `fp:calibrate`.

`fp:diff` é o que vira fatura: inclusão / alteração / exclusão, com os fatores da
AEP por default e SISP como preset. Duas decisões que o tornam viável:

- **opera sobre dois inventários salvos** (`fp-inventory.json` gerado por
  release e guardado como artefato), nunca sobre dois checkouts. Bootar a versão
  antiga, com dependências possivelmente diferentes, é exatamente o tipo de
  problema que não vale resolver.
- **recusa comparar inventários de `rulesetVersion` diferentes.** A arquitetura
  exige o ruleset versionado; este é o item que o implementa: sai em todo
  relatório, e o diff falha em vez de somar laranjas com maçãs.

`fp:explain` merece teste próprio — a procedência é requisito, não enfeite, e
tem que sobreviver a refatoração.

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
Fase 4 contra a app real **em dois momentos**: com o grafo sintático, e no dia
em que o type checker entrar — porque é ele que muda a ordem de grandeza. Teto
proposto para discutir: 60 s numa app de 1100 arquivos, sem cache.

## Ordem, e por quê

Fases 1–3 são baratas e produzem fato canônico — com uma ressalva de
sequência: dentro delas, **AST vem antes de runtime**, porque as fixtures não
bootam. A Fase 4 é cara e concentra o risco, e dentro dela o grafo sintático vem
antes do type checker. A Fase 5 é quase aritmética, porque as tabelas já existem.

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
