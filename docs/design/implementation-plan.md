# Plano de implementação

> **Registro datado — setembro/2026.** Este documento descreve o que foi medido e
> decidido naquele momento, não o comportamento atual do pacote. Conclusões
> daqui podem ter sido revistas depois; a referência viva é
> [`architecture.md`](architecture.md).

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

|       |                                                              |
| ----- | ------------------------------------------------------------ |
| feito | **Fases 1 a 8** — o plano inteiro; 210 testes, nenhum pulado |
| falta | nada do plano original; ver "Depois do v1"                   |

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
│   └── vazquez/             benchmark público, gabarito 46 PF
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

### 3a — parser de rotas ✅

Entregue: `collectEntryPoints` lê os arquivos de rota descobertos na Fase 1 e
produz `EntryPoint` com verbo, padrão, nome, handler resolvido e **identidade**
(`verbo` + padrão com parâmetros anonimizados, counting-decisions §5).

Cobre: rota de uma linha e multi-linha; grupo com prefixo e `.as()`, inclusive
aninhado; `.resource()` com `.only()` / `.except()` / `.apiOnly()`; controller
por lazy import e por mapa gerado indexado pelo caminho pontuado; `router.on()`
sem handler; e closure inline como handler.

Validado contra 5 aplicações de produção, usando o registry gerado pelo Tuyau
como **gabarito independente**. As únicas rotas do registry que o parser não
encontra são `/uploads/*` (pacote Drive) e `/__transmit/*`
(`transmit.registerRoutes()`) — exatamente as rotas de terceiros que a decisão
§2 manda não contar. **Zero falso positivo e zero pendência** em todas. Entre 4
e 79 ms por aplicação.

Dois achados que só a app real revelou:

- **Ler a cadeia por regex no texto do statement é errado.** O texto de um grupo
  externo contém os grupos aninhados, e o `.prefix()` do interno aparece antes
  do próprio — produzia `/trash/trash/books` no lugar de `/admin/trash/books`.
  A leitura passou a ser estrutural: sobe a cadeia de chamadas daquela chamada.
  Vale igual para `.as()`, `.only()` e `.apiOnly()`.
- **Closure inline é handler, não pendência.** `router.get('/', ({ response }) =>
…)` aparece em 3 das 5 apps. Tratá-la como "controller não resolvido" perderia
  a transação e reportaria o motivo errado. `HandlerRef` ganhou `line` para
  apontar o corpo, que a Fase 4 vai percorrer.

### 3b — DETs de entrada ✅

Os campos declarados nos validators são contados pela tabela de tipos compostos
(§7) e ligados à transação a partir do handler (`request.validateUsing(x)`), o
que fez desta a ponte natural para a Fase 4 — está implementado em
`call_graph.ts`, não num coletor separado. Spread não resolvido conta 0 e vira
pendência, nunca chute. O cruzamento com o registry do Tuyau fica para depois do
v1.

## Fase 4 — o grafo _(a fase cara)_

### 4a — grafo sintático ✅ com lacuna medida

Entregue: `createAnalyzer` percorre da transação até as funções de dados em
**nível de método**, seguindo o grafo de chamadas pelas estratégias
registráveis. Produz `writes`, `touches`, `trace` com quem resolveu cada passo,
`scope` com hash de AST normalizado (§5) e `unresolved`.

Detector do Lucid no **call site**, com o mapa de símbolos resolvendo: model
importado, variável local derivada (`const invite = await Invite.find(...)`),
parâmetro tipado, parâmetro desestruturado com tipo inline, e **caminho de
propriedade sobre tipo nomeado** (`input.invite.save()` com
`interface Input { invite: Invite }`) — este último o padrão dominante nas apps
reais, que sozinho respondia por parte grande da subdetecção.

Nas fixtures: os 7 padrões alcançam o dado e detectam a escrita, e quem chama só
o método de leitura de um service não vira escritor.

**Medição honesta contra app de produção**, e a lacuna é real:

| app   | rotas | EE detectado | rotas com verbo de escrita | tempo |
| ----- | ----- | ------------ | -------------------------- | ----- |
| app C | 161   | 40           | 107                        | 42 s  |
| app D | 58    | 26           | 29                         | 3,5 s |

O verbo HTTP **não é gabarito** — parte dos POST só lê (um `POST .../export`
que devolve PDF é SE, não EE). Mas a distância em `app C` é grande demais
para ser só isso.

Dois defeitos corrigidos no caminho, e o segundo é de princípio:

- **Um `Project` do ts-morph por handler.** Multiplicava o custo pelo número de
  rotas: passava de dois minutos por app. Projeto e caches compartilhados no
  `createAnalyzer`.
- **O filtro de pendência escondia o buraco.** Só reportava `this.`, então toda
  chamada não seguida a código da própria aplicação sumia em silêncio — o
  oposto do princípio do pacote. Agora reporta símbolo importado da aplicação
  também, e o número de pendências subiu porque passou a ser verdadeiro.

### 4b — cobertura e desempenho ✅

**Cobertura.** O diagnóstico rota a rota mostrou que a lacuna não era difusa:
das 68 rotas de escrita não detectadas em `app C`, quase todas paravam no
**primeiro passo**, com `this.algumServiço.metodo()`.

E a suposição registrada sobre esse caso estava errada. A revisão anterior
afirmou que `property_service` exigiria o type checker e multiplicaria o custo
da análise. Não exige: o `@inject()` do AdonisJS **só funciona com a anotação de
tipo explícita**, então `constructor(protected billing: BillingService)`
traz o tipo como identificador importado — resolvível pelo mesmo mecanismo de
import já existente.

| app   | EE antes | EE depois | rotas com verbo de escrita |
| ----- | -------- | --------- | -------------------------- |
| app C | 40       | **84**    | 107                        |
| app B | 68       | 68        | 85                         |
| app A | 57       | 57        | 70                         |
| app D | 26       | 26        | 29                         |

A lista de lacunas conhecidas ficou **vazia**.

**Desempenho.** De 56 s para 2,2 s na maior app — 25×.

A causa não era o caminhamento do AST (um cache de fatos por corpo não mudou
nada). Era interleaving: **adicionar arquivo ao projeto depois de consultar o
checker invalida o programa do TypeScript**, e a consulta seguinte o
reconstrói. Custava ~344 ms por rota, uniformemente. Carregando todos os
arquivos antes da primeira análise, a primeira rota paga 2,2 s e as demais 1 ms.

| app   | antes | depois |
| ----- | ----- | ------ |
| app C | 56 s  | 2,2 s  |
| app B | 47 s  | 1,5 s  |
| app A | 32 s  | 1,0 s  |
| app D | 3,5 s | 0,4 s  |

Regressão registrada em teste, e ela **mede a causa, não o tempo** — tempo seria
instável em CI. A primeira versão do teste não tinha dentes: comparava o número
de arquivos entre duas análises, que o cache de fatos mantém igual de qualquer
forma. Corrigido para comparar antes da primeira análise.

### 4c — rotas sem dado investigadas ✅

As 24 rotas de `app C` que não alcançavam repositório nenhum foram
examinadas uma a uma. Metade era **comportamento correto**: `/health`,
`/metrics`, `router.on()` estático, e telas de formulário (`GET /login`,
`/users/create`, `/settings/password`) que não recuperam dado — pelo AFP não
são funções transacionais.

A outra metade era uma lacuna com padrão único: **`this.metodoPrivado()`**, o
método público delegando a privados da mesma classe, onde a escrita acontece.
Nenhum resolvedor cobria — `property-service` exige `this.prop.metodo()`, dois
níveis.

| app   | EE antes da 4c | depois | verbo de escrita |
| ----- | -------------- | ------ | ---------------- |
| app C | 84             | **91** | 107              |
| app B | 68             | **77** | 85               |
| app A | 57             | **61** | 70               |
| app D | 26             | 26     | 29               |

Detecção entre 85% e 91% das rotas com verbo de escrita. FTR médio também subiu
(1,47 → 1,66 em `app C`), o que muda complexidade.

E um defeito de princípio corrigido: quando o resolvedor acertava o arquivo mas
`findBody` não achava o corpo — método herdado de classe de pacote, como
`Transformer.transform()` de `BaseTransformer` — a informação era **descartada em
silêncio**. Agora vira pendência com o motivo certo.

### Ainda em aberto na Fase 4

- **Hooks de model** (§3) e **fronteira de `node_modules`** (§4) — não
  implementados.
- A distância entre EE detectado e rotas com verbo de escrita (91 de 107 em
  `app C`) é parcialmente legítima: `POST .../export` que só lê é SE, não
  EE. Quanto exatamente, só a calibração da Fase 6 dirá.

## Fase 5 — `albrecht`: as regras ✅

Entregue o motor de contagem inteiro: funções de dados (ALI/AIE pela regra de
manutenção da AFP §6.5.4), funções transacionais (EE/SE pela regra de escrita
§6.5.3, com CE colapsado), filtro de dados técnicos (§6.5.2.1.1) e `CountResult`
com `Rationale` rastreável em cada função.

**A invariante de ouro está inteira**: as três apps produzem contagem idêntica,
função por função, incluindo tipo, DET, FTR e pontos.

Duas peças que a fase exigiu e não estavam previstas:

- **Resolução de relação.** `Book.query().preload('author')` lê a tabela de
  autores. Sem isso, uma tabela lida só por relação não é alcançada por
  transação nenhuma e cai fora pela §6.5.4 — quando é um AIE legítimo. Na
  fixture, é a diferença entre `Author` contar ou não.
- **DETs de entrada** (a Fase 3b que faltava): `request.validateUsing(x)`
  resolvido até as folhas do schema VineJS, pela tabela de §7. Spread não
  resolvido conta 0, nunca chuta.

### Primeira contagem em produção

| app         | PF  | ALI | AIE | EE  | SE  | tempo |
| ----------- | --- | --- | --- | --- | --- | ----- |
| app A       | 910 | 35  | 0   | 61  | 74  | 1,3 s |
| app B       | 829 | 22  | 6   | 77  | 56  | 2,0 s |
| app C       | 778 | 21  | 4   | 91  | 43  | 3,2 s |
| app D       | 259 | 10  | 2   | 26  | 16  | 0,5 s |
| starter-kit | 99  | 4   | 0   | 15  | 6   | 0,4 s |

O spike estimara 844–890 PF para `app C`; o motor dá 778. A diferença é
explicável e a favor do motor: o spike contava os 32 models como funções de
dados, e agora tabelas órfãs e técnicas saem — 25 contadas de 32.

### Testes sem dentes, revelados por mutação

Duas guardas do contador passavam mutação porque `minimal_flat` **não tem** o
caso que elas cobrem: toda tabela dela é alcançada e toda rota alcança dado.
Foi preciso uma fixture de borda (`edges_boundary`) com tabela órfã, tabela
técnica e rota sem dado. Seis mutações agora falham.

É a terceira vez que "mutação passou verde" aponta um teste que afirmava menos
do que parecia. A regra de processo está se pagando.

## Fase 6 — validação ✅

### Benchmark Vazquez: 46 PF contra 46 PF de gabarito

A fixture e o gabarito foram **congelados em commit próprio antes** de o contador
rodar sobre eles, com as escolhas de transcrição documentadas em
`fixtures/apps/vazquez/REFERENCE.md`. Sem isso a independência seria ilusória.

|                                  | total  | vs gabarito |
| -------------------------------- | ------ | ----------- |
| Vazquez et al., manual publicada | 46     | —           |
| **este pacote**                  | **46** | **0%**      |
| Ligeiro, automático sobre MDArte | 52     | +13%        |
| manual pelas regras do Ligeiro   | 43     | −6,5%       |

**8 das 10 funções batem exatamente**, incluindo as três funções de dados com
tipo, DET, RET e pontos idênticos.

**O total exato é em parte cancelamento, e isso está registrado no teste.** As
duas divergências são +1 e −1, e as duas foram **previstas por escrito antes de
rodar**:

- `Consulta Apontamento Diário` é CE no gabarito; o AFP §6.5.3 manda colapsar CE
  em SE, e SE pesa mais na mesma faixa. **+1 PF.**
- `Apontamento c/ Justificativa`: o manual do IFPUG conta 1 DET de mensagem ao
  usuário, o AFP não. **−1 PF.**

É a confirmação externa do que o spike havia observado: **o total é mais estável
que a classificação individual.** Quem for defender a contagem função por função
precisa saber disso.

### Duas correções que o benchmark forçou

**O gabarito estava errado nos documentos.** Vinham escritos 56 PF e desvio de
~7%. A extração do PDF interleava o número da página entre os dois totais da
Tabela 6.5, e o número da página foi lido como gabarito. O texto da dissertação
desfaz a dúvida — _"tendo o processo automático obtido o maior valor"_, e o
automático é 52, logo a referência é menor. Somando a coluna à mão: 46.

**A regra de DET estava errada, e só o benchmark expôs.** Os DETs de saída eram
um `else` dos de entrada, então um relatório com filtro de período contava 2
DETs onde o gabarito conta 9, e uma exclusão contava 8 onde o gabarito conta 2.
O AFP §7.3 manda contar todo campo necessário para completar a transação, com a
distinção por TIPO: EE conta o que o usuário informa; SE conta o que ele informa
**mais** o que a transação apresenta.

O efeito nas apps de produção foi grande — e nenhuma fixture o teria pego:

| app   | antes | depois |
| ----- | ----- | ------ |
| app A | 910   | 954    |
| app B | 829   | 807    |
| app C | 778   | 714    |
| app D | 259   | 257    |

### Fumaça em app real

Cinco aplicações de produção contadas de 0,4 a 3,2 s cada, sem pendência de
rastreamento bloqueante. Os totais estão na tabela da Fase 5, acima.

## Fase 7 — superfície de uso ✅

`src/pipeline.ts` concentra a orquestração e os comandos ace ficam finos — sem
lógica, só imprimindo o que o pipeline devolve. É isso que permite testar a
contagem inteira sem bootar uma aplicação: as fixtures não bootam.

| comando                   | o que faz                                                        |
| ------------------------- | ---------------------------------------------------------------- |
| `fp:inventory`            | fatos crus e cobertura do rastreamento; `--out` salva JSON       |
| `fp:count`                | contagem não ajustada; `--out`, `--json`, `--min-coverage`       |
| `fp:explain <função>`     | procedência: regra, origem de cada DET e FTR, caminho percorrido |
| `fp:diff <anterior.json>` | inclusão / alteração / exclusão, e o PF faturável                |

### `fp:diff` — as duas decisões que o tornam viável

**Opera sobre uma contagem salva**, comparada com o estado atual — nunca sobre
dois checkouts. Bootar a versão antiga, com dependências possivelmente
diferentes, é problema que não vale resolver.

**Recusa comparar rulesets diferentes.** Se as regras mudaram entre as duas
medições, a diferença não mede trabalho: mede a mudança de regra. E o resultado
iria para uma fatura.

Fatores por tipo de mudança, com os âncoras explícitos da AEP §6.5: adicionada
1, excluída 0,4. **Alterada é 1 por default e isso superestima** — a AEP grada
de 0,25 a 1,75 pela variação de Effort Complexity, que exige complexidade
ciclomática, ainda não medida aqui. Contar 1 é a escolha de não inventar número,
não a de faturar menos, e **o resultado avisa**: cobrar valor cheio por uma
alteração de uma linha sem dizer nada seria indefensável.

### Cobertura como porta

`analyze()` aceita `minCoverage` e **falha** abaixo dele, com mensagem que diz o
que fazer (`fp:inventory` para ver as pendências). Um número com rastreamento
ruim não deveria virar fatura.

## Fase 8 — calibração e métricas estatísticas ✅

### `fp:calibrate`

Mede o viés do contador contra contagem manual, **sem aplicar o fator**:
calibrar é decisão de quem assina o contrato, e um fator aplicado em silêncio
faria a contagem deixar de ser reproduzível a partir do código.

O benchmark Vazquez serve como conjunto de calibração de teste — 10 funções com
valor manual publicado. E revela o que o total esconde: com desvio total de 0%,
o fator por tipo mostra **SE superestimado e EE subestimado**, porque as duas
divergências se cancelam.

Três guardas contra número enganoso, todas testadas:

- **amostra pequena demais** (< 10 por tipo) avisa que o fator é ruído;
- **amostra que não casa** é reportada, não descartada;
- **tudo batendo exatamente** levanta suspeita de que a "contagem manual" saiu
  da automática — calibrar contra si mesmo não mede nada.

### Métricas estruturais

Derivadas do mesmo inventário, sem coletar fato novo. É o que torna quase
gratuito: se o grafo já sabe quais transações alcançam quais repositórios,
acoplamento e densidade são aritmética.

**Acoplamento é de USO, não de import.** O módulo A depende de B quando uma
transação de A alcança um repositório declarado em B. Import de tipo não cria
acoplamento funcional. Com instabilidade de Martin (`Ce/(Ca+Ce)`) e detecção de
dependência mútua.

**Conformidade** com a própria convenção: escrita com validator declarado, rota
com handler resolvido, repositório alcançado por alguma transação.

Medido em produção:

| app   | PF  | PF/repositório | ciclos | escrita c/ validator |
| ----- | --- | -------------- | ------ | -------------------- |
| app A | 954 | 27,3           | 0      | 64%                  |
| app C | 714 | 22,3           | **2**  | 42%                  |

Os dois ciclos entre módulos do `app C` e os 42% de escrita sem validator
são achados reais, não ruído da ferramenta.

### Por que isto anda junto com PF

Se PF paga, o time otimiza PF: mais models, mais endpoints, menos reuso.
Densidade e acoplamento no mesmo painel são o contrapeso — sem eles a métrica
vira alvo, não medida.

## Depois do v1

- **Fronteira de `node_modules`** (§4), decidida e não implementada.

- **Hooks de model (§3): implementado depois do v1.** O resultado confirmou a
  medição abaixo — os totais das quatro apps não mudaram em nenhum PF, e só o
  FTR médio de uma delas subiu de 2,17 para 2,18, sem cruzar faixa. A fixture
  `model_hooks` prova o caso que importa, onde a tabela da cascata é escrita só
  pelo hook e sem isso sumiria da contagem pela §6.5.4.

  **Medido antes de priorizar (set/2026).** Nas 4 apps: 10 hooks no total, e uma
  delas não tem nenhum. Do total, 7 não tocam dado — 3 são `refresh()` da própria
  linha, 1 é log, e os outros normalizam campo antes de salvar. Sobram 3 que
  alcançam OUTRA tabela: um lê tabela de referência, dois apagam em cascata.

  O efeito esperado é pequeno, e por um motivo que só a medição mostra: as três
  tabelas alcançadas por hook **já são contadas**, porque outras transações as
  alcançam também. Então hooks não acrescentariam função de dados nenhuma; só
  somariam FTR a um punhado de transações — na app maior, 3 a 6 rotas de 134,
  com no máximo 1 PF cada, sobre um total de 714. Menos de 1%.

  A regra do §3 continua certa e a lacuna continua real: numa app onde a tabela
  da cascata só fosse escrita pelo hook, ela seria função de dados inteira
  faltando, não arredondamento. Mas nestas não é o caso, e isso põe hooks abaixo
  de qualquer coisa que erre o número inteiro.

- **Fator de alteração graduado** no `fp:diff`: exige complexidade ciclomática,
  que a AEP usa na Tabela 6.1. Hoje é 1 e avisa que superestima.
- **Hotspots churn × complexidade**, que exigem histórico do git.
- **Kysely**, com a fixture sentinela já no lugar.

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

**Orçamento de desempenho — medido, dentro do teto.** As fixtures têm 2
entidades; as apps reais medidas vão a ~48 entidades e ~1100 arquivos. O teto
proposto era 60 s sem cache; o grafo sintático fica em 1–3 s por app depois da
correção de invalidação do programa do TypeScript (Fase 4b). O orçamento volta a
valer no dia em que o type checker entrar, porque é ele que muda a ordem de
grandeza.

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
