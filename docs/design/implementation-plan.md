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

## Taxonomia das fixtures

```
tests/fixtures/
├── apps/                     aplicações completas e mínimas
│   ├── minimal_flat/           MVC plano
│   ├── minimal_modular/        módulo por domínio — MESMA app lógica
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

**Pronto quando:** as duas fixtures de app produzem o mesmo `AppContext`
normalizado, diferindo só em `layout`.

## Fase 2 — `sources/data_schema`: funções de dados

**Por que aqui:** é a metade confiável da contagem (~24% do total, quase sem
heurística), e a invariante de ordem do `ResolverContext` exige que os data
stores existam antes de qualquer análise de handler.

Exemplos antes do código:

- os três estilos em `fixtures/models/` produzem **as mesmas colunas** — é o que
  impede a falha silenciosa que zeraria uma app inteira
- `static $columns` é preferido ao AST quando presente
- coluna acrescentada por migration de "pacote" aparece; propriedade transiente
  (como `auditComment`) não

**Pronto quando:** `DataStore[]` idêntico entre as duas fixtures de app.

## Fase 3 — `sources/route_registry`: transações candidatas

Exemplos antes do código:

- rota do registry vira `EntryPoint` com verbo, padrão, nome
- `body`/`query` do registry viram DETs de entrada, sem parsear validator
- `controllers_map` resolve pelo caminho pontuado; **fixture com nome colidindo
  entre dois módulos** prova que resolve o certo
- sem registry, `routes_ast` assume — com as armadilhas já conhecidas: rota
  multi-linha, `.resource()` expandido, `.only()`/`.apiOnly()`

**Pronto quando:** as duas fixtures de app produzem o mesmo conjunto de
`EntryPoint`.

## Fase 4 — `graph/call_graph`: o rastreamento

**A fase cara.** O spike mostrou que aqui mora a incerteza: a detecção de escrita
decide EE vs SE em ~40% das transações.

Exemplos antes do código:

- cada uma das 7 fixtures de `patterns/` alcança o data store e detecta a
  escrita — inclusive `property_service`, hoje lacuna conhecida
- **nível de método, não de arquivo**: fixture com service que tem um método de
  leitura e um de escrita; quem chama só o de leitura não vira EE
- `edges/model_hook/`: a escrita no `@afterCreate` entra na transação que a
  disparou e soma FTR
- `edges/static_route/`: não alcança dado, não vira função, **e aparece no
  relatório de cobertura**
- `edges/vendor_route/`: idem, sem precisar de lista de exclusão
- chamada que nenhum resolvedor segue entra em `unresolved` com arquivo e linha

**Pronto quando:** cobertura de 100% nas fixtures e o relatório distingue "rota
legitimamente estática" de "rastreador falhou".

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
