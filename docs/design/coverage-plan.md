# Plano: tornar a cobertura um portão confiável

Medido em 24/09/2026 contra uma aplicação de produção (app C, revisão
`adef4ee3`, 188 pontos de entrada). A revisão fica registrada de propósito:
uma tabela de medição sem o sujeito identificado já custou meio dia de caçada a
uma regressão que não existia.

## O problema

```
coverage: 53,2% (190 chamadas não resolvidas)
```

Com `minCoverage: 0.85` — o valor que o próprio stub sugere — essa contagem
**falharia**. E falharia com razão aparente e motivo errado: o rastreamento de
dados dessa aplicação é muito melhor que 53%.

Duas coisas se somam para produzir esse número.

**A razão é tudo-ou-nada por transação.**

```ts
ratio = transações com ZERO pendências / total de transações
```

Um único `this.logger?.error` num handler derruba a transação inteira de
"coberta", por perfeito que esteja o resto. O custo de uma chamada de ruído não
é uma pendência — é uma transação.

**E o filtro de pendência é permissivo demais.** `isWorthReporting` reporta
tudo que é `this.` e tudo que vem de símbolo importado da aplicação. Isso
alcança serviço do framework (`env` mora em `#start/env`, que é módulo da
aplicação), método de `Map`, de array, de luxon, e método herdado do Lucid.

Nada disso é acesso a dado. Nada disso deveria contar contra a cobertura.

**Por que isso importa mais do que parece:** um portão que reprova à toa não
protege — ele ensina a desligar o portão. E aí a proteção que existe para
impedir que um número ruim vire fatura deixa de existir, silenciosamente.

## Não é configuração

Vale afirmar porque é a primeira hipótese natural: a aplicação medida não está
mal configurada. A superfície de configuração do pacote são decisões de
fronteira — quais repositórios são infraestrutura, quais são mantidos
externamente, quais rotas ignorar — e **nenhuma das 190 pendências é pergunta
de fronteira**. São todas do rastreador.

## As 190, por causa

| n   | causa                                                       | fase |
| --- | ----------------------------------------------------------- | ---- |
| 47  | transformer herdando base de pacote                         | 3    |
| 44  | método de array/objeto sobre símbolo da aplicação           | 1    |
| 31  | chamada encadeada sobre retorno de transformer              | 3    |
| 18  | método de `Map` / luxon                                     | 1    |
| 12  | helper da própria classe (`this.pick`, `this.addDays`)      | 1    |
| 10  | service injetado por valor default                          | 2    |
| 9   | serviço do framework (`env.get`, `health.run`)              | 1    |
| 8   | `this.logger?.*`                                            | 1    |
| 6   | método herdado do Lucid (`useTransaction`)                  | 1    |
| 5   | indeterminado de verdade (`this.redis.*`, `this.authz.can`) | —    |

A classificação é por forma da expressão, então é aproximada nas bordas.

## Projeção, e o que já foi medido

Quantas transações ficam completamente limpas a cada fase, na app C:

|                                    | cobertura          | ganho |
| ---------------------------------- | ------------------ | ----- |
| hoje                               | 53,2%              | —     |
| fase 1 — filtro de ruído           | **59,0% (medido)** | +11   |
| fase 2 — injeção por valor default | **63,8% (medido)** | +9    |
| fase 3 — transformers              | **79,3% (medido)** | +31   |

**A fase 1 está entregue, e 59,0% é medido, não projetado.** A projeção original
dizia 64,9% com um filtro que silenciava também `get`, `set`, `has` e `find` —
métodos de `Map` e de repositório igualmente. Silenciá-los compraria cobertura
escondendo lacuna, que é o defeito que o pacote existe para não cometer. O
filtro conservador rende menos e é o certo; as projeções das fases 2 e 3 foram
reduzidas na mesma proporção.

Nas outras três aplicações a fase 1 deixou a cobertura em 69,9%, 68,7% e 72,4%.
A app C é a mais difícil das quatro, o que a torna o alvo certo para medir.

As três juntas passam de 0,85, que é onde o portão começa a valer. **Nenhuma
delas sozinha chega lá** — e a fase 3, a mais cara, é também a que mais rende.

## Fase 1 — o filtro de pendência ✅

O que nunca deveria ser reportado:

- serviço do framework, mesmo alcançado por alias da aplicação (`env`, `health`,
  `hash`, `mail`, `drive`, `emitter`, `logger`)
- método de tipo nativo: `Map`, array, `Date`, luxon
- método herdado do Lucid que não é acesso — `useTransaction`, `serialize`,
  `refresh`, `toJSON`
- `.validate()` de validator VineJS

**Invariante desta fase: nenhum ponto de função pode se mover.** Pendência não
entra na contagem, só na cobertura — então se o total mudar, o filtro removeu
algo que era acesso a dado de verdade.

**Verificada:** as quatro aplicações voltaram com os totais idênticos — 954,
807, 768, 257 — e o benchmark Vazquez seguiu em 46 PF.

O risco desta fase é silenciar demais, que é o defeito que este pacote existe
para não cometer. Mitigação: a lista é de formas _conhecidas_, nunca um
`catch-all`; o que não casar continua sendo reportado.

## Fase 2 — injeção por valor default ✅

```ts
constructor(private billing = new BillingService()) {}
```

Propriedade de construtor com valor default e **sem anotação de tipo** —
injeção sem container. O `injectedFor()` lê só `getTypeNode()`, que aqui é
`undefined`, então não enxerga nada. Mas `new BillingService()` está no AST, e
é exatamente o que o `action-object` já sabe ler.

Esta fase **pode mudar a contagem**, e legitimamente: seguir o service pode
revelar escrita que hoje não é vista, virando EE o que era SE.

**Medido: não mudou.** Os quatro totais seguem em 954, 807, 768 e 257. A
fixture `default_injection` prova que a reclassificação é real — sem o fix, a
transação dela conta como SE porque a escrita dentro do service fica invisível
— mas nenhuma das quatro aplicações tinha esse caso. A cobertura da app C subiu
de 59,0% para 63,8%, e as outras três não mudaram: o padrão só existe numa
delas.

## Fase 3 — transformers ✅ (não era a fronteira de `node_modules`)

Os 47 transformers e as 31 chamadas encadeadas são o mesmo padrão. **E a
premissa deste plano sobre eles estava errada.**

Previa-se entrar um nível em `node_modules`, pela decisão §4. Não foi
necessário: as 33 transformers estendem `BaseTransformer` do `@adonisjs/core`,
e `transform()`/`paginate()` do pacote **chamam de volta** o `toObject()` que a
aplicação escreve. O corpo que interessa sempre esteve na aplicação. É a mesma
forma do `job-dispatch`, onde `dispatch` enfileira e `handle` executa.

Virou um resolvedor (`transformer`, ordem 18, antes do `static-service` porque
`X.transform(p)` também é `Identificador.metodo(args)`), não travessia de
pacote. A fronteira de `node_modules` da §4 **continua não implementada** — e
continua não sendo necessária para isto.

Efeito medido: a contagem não mudou em nenhuma das quatro aplicações, embora a
fixture prove que pode — nela, uma tabela escrita só dentro do `toObject()`
sairia da contagem pela §6.5.4 sem este resolvedor.

Seguir os transformers **expôs uma segunda camada de ruído**: `this.pick` (24
ocorrências) e `this.whenLoaded` (14) são auxiliares do próprio
`BaseTransformer`, chamados de dentro do `toObject()` que passamos a alcançar.
Entraram no filtro da fase 1, e valem 6 pontos de cobertura.

## Onde as três fases chegaram

| app | antes | depois    |
| --- | ----- | --------- |
| A   | —     | 79,7%     |
| B   | —     | 85,9%     |
| C   | 53,2% | **83,5%** |
| D   | —     | 91,4%     |

Os últimos pontos vieram de três falhas do próprio filtro, achadas **rodando**
contra produção e não por raciocínio: numa cadeia
`validator.validate(p).catch(…)` o método reportado é `catch`, de Promise, e não
`validate`; um `Map` recebido por parâmetro de construtor não era reconhecido,
porque só propriedades de classe eram lidas; e `this.logger?.error` escapava,
porque serviço de framework só era reconhecido como identificador nu.

**A meta de 0,85 foi alcançada em duas das quatro** (B 85,9%, D 91,4%), e a app
C ficou a 1,5 ponto. A projeção original prometia 86,2% com um filtro que
silenciava `get`/`set`/`has`/`find` — cobertura comprada esconderia lacuna, e
não compensa.

O que sobra na app C são 109 pendências, e a leitura honesta é que **o limite
de 0,85 talvez seja o número errado para uma aplicação com 172 funções**. Um
`minCoverage` por aplicação, calibrado com o número na mão, defende melhor que
um número redondo escolhido antes de medir. Essa decisão é de contrato, não de
código.

## Como saber que terminou

1. Cobertura da app C acima de 0,85, com `minCoverage: 0.85` passando.
2. Benchmark Vazquez em 46 PF, intacto.
3. Fase 1 sem mover nenhum ponto de função em nenhuma das quatro apps.
4. Fases 2 e 3 com o efeito na contagem medido e registrado, não presumido.
5. Cada fase com fixture própria, escrita antes do código.

## O que este plano NÃO faz

Não persegue 100%. As pendências indeterminadas (`this.redis.*`,
`this.authz.can`) são exatamente o que o AFP §6.5.3 manda catalogar e reportar
— elas _devem_ continuar visíveis. Um rastreador que reporta zero pendências ou
é perfeito ou está mentindo, e o segundo é mais provável.

## Fase 4 — o que o uso real mostrou ✅

As três fases acima foram planejadas. Esta veio de instalar a 0.1.0 numa
aplicação e ler o relatório: nenhuma das quatro causas abaixo apareceria por
raciocínio, e juntas respondiam pela maior parte do que sobrava.

| app | fim da fase 3 | fase 4    |
| --- | ------------- | --------- |
| A   | 79,7%         | **94,8%** |
| B   | 85,9%         | **95,1%** |
| C   | 83,5%         | **98,4%** |
| D   | 91,4%         | 91,4%     |

**As quatro causas.** Duas eram bugs, duas eram lacunas de projeto.

1. **Iteração reivindicada por um resolver.** `LABELS.map(cb)` tem a forma
   `Identifier.method(args)`, então `static-service` reivindicava, resolvia o
   módulo de enum e reportava falta de `map` nele — o filtro de ruído nunca era
   consultado, porque ele só entra depois que todas as estratégias declinam.
   Sozinha, 30 das 40 pendências da app A.
2. **O método de execução do job.** `@nemoventures/adonis-jobs` chama de
   `process`, não `handle`. Procurar só `handle` resolvia o arquivo e não achava
   corpo: a pendência era falsa **e** as escritas dentro do job não eram
   contadas. 14 dispatches na app C.
3. **Import com alias.** `moduleFunctionResolver` usava o nome local como
   membro, então `import { x as y }` procurava `y` num arquivo que exporta `x`.
4. **Chamada sobre o resultado de chamada.** `dispatch(j).waitResult()` era
   reportada, embora a chamada interna — que é onde o desconhecido está — já
   fosse reportada no mesmo corpo. Cobrava duas vezes pelo mesmo buraco.

**A contagem mexeu 1 ponto em uma das quatro** (app C, 772 → 773), e por causa
da (2): seguir o `process` alcança dados que antes não eram alcançados. As
outras três não movem ponto nenhum, como manda o invariante.

**As quatro passaram de 0,85.** O que sobra são 19 pendências nas quatro, e cada
uma é uma coisa real, não ruído:

- `events.X.dispatch` (4) — evento pelo registry gerado; quem grava é o
  listener. É capacidade que falta, não falso positivo. **Feito na fase 5.**
- `this.authz.can` / `user.assignRole` (8) — o pacote de autorização da casa;
  `can` provavelmente lê tabela de permissão.
- `guias.load` (2) — **não é `model.load('relacao')` do Lucid.** É
  `Collection.load()` do `@adonisjs/content`, lendo JSON de arquivo. A conclusão
  errada durou uma frase porque foi tirada do nome do método, que é exatamente o
  que o filtro de ruído existe para não fazer. Conteúdo em arquivo pode ou não
  ser função de dado — é decisão de fronteira e não foi tomada.
- `getVariant` (3), `limiter.penalize` / `limiter.delete` (2) — pacotes de
  anexo e de rate limit; não tocam dado da aplicação. Resolvíveis pelo
  `ignores()` no config do projeto, que é o lugar certo.

## Fase 5 — dispatch de evento ✅

| app | fase 4 | fase 5    |
| --- | ------ | --------- |
| A   | 94,8%  | **95,4%** |
| B   | 95,1%  | 95,1%     |
| C   | 98,4%  | 98,4%     |
| D   | 91,4%  | 91,4%     |

Fecha as 4 pendências de `events.X.dispatch` da app A e acrescenta um FTR a 3
transações. **Não moveu nenhum ponto de função**, e vale registrar em vez de
esconder: as tabelas foram alcançadas, e nenhuma das três cruzou faixa de
complexidade. Medição mais completa com total igual — é o efeito de
granularidade que o §7 do counting-decisions já descreve, visto do outro lado.

Duas coisas que o fixture cobre e que o app real não tem: o binding que nomeia o
método (`[[Listener, 'onShipment']]`) e a forma direta `Evento.dispatch(p)` — que
tem a mesma forma que o `job-dispatch` casa, e por isso o resolver de evento
roda antes (ordem 12).

`dispatchMany` entrou na lista de métodos de dispatch de job no mesmo passo:
apareceu dentro de um listener, no caminho que só passou a ser percorrido agora.

## Fase 6 — `fp:diff` contra histórico real, e um erro meu

Primeira vez que o diff viu duas medições reais: releases v0.7.0 (1/jul, 648 PF)
e v0.9.0 (13/ago, 717 PF) da mesma aplicação, por worktree.

Achou três coisas, e nenhuma delas era o que eu esperava.

1. **`Billable FP: 485.00000000000006`.** Aritmeticamente o mesmo número e não o
   mesmo documento — esse valor vai para uma fatura. Arredondado na origem, não na
   impressão.
2. **O aviso estava embaixo de 118 linhas** de saída por função. Aviso que precisa
   de rolagem não é aviso. Subiu para logo depois do total, e passou a dizer o
   valor: "378 de 485 PF faturáveis (78%) são funções modificadas a fator fixado em
   1".
3. **`factors` não era alcançável por nenhum front-end** — ponto de extensão
   tipado que só um teste usava. O mesmo defeito do `config/function_points.ts` e
   do `fp:metrics`. Agora sai de `diff.factors` / `diff.reasonFactors` no config.

E o `reasonFactors`, que é o que o default deixava na mesa: das 378 PF cobradas
como mudança, **151 eram `implementation`** — mesmo tipo, mesmo DET, mesmo FTR, só
o corpo diferente. Cobrar refatoração a valor funcional cheio não se defende;
cobrar a um número que o pacote inventou seria pior. O número vem do contrato.

### O erro: métrica que induz a conclusão errada

O `fp:metrics` reportava `writes with a validator: 39%`, e eu li isso como
subcontagem em 61% dos writes. Construí aviso em cima disso. **Estava errado**, e
o §7 do counting-decisions já dizia: as transações sem validator são gatilhos de
fluxo (`POST /pedidos/:id/submeter`, `DELETE /questoes/:id`) que legitimamente não
carregam nada além do parâmetro de rota.

Duas versões do aviso apontaram rotas que não tinham nada de errado. A terceira
foi atrás do sinal decisivo — o handler lê o request? — e daí saíram duas coisas
de verdade:

- **`request.input('x')` passou a contar como DET.** §7.2 pergunta se campo
  reconhecível pelo usuário cruza a fronteira, não como foi declarado. Mexeu em
  **3 transações nas quatro apps e 0 PF**, e isso é evidência de que generaliza:
  não depende do estilo de ninguém. Vai importar numa aplicação que leia o request
  direto.
- **A métrica foi redefinida.** Denominador agora são as transações que _tomam_
  entrada. Nas quatro apps dá ~100%, que é a verdade. Métrica que faz o leitor
  concluir errado é pior que métrica nenhuma — e essa fez o próprio autor concluir
  errado.

O aviso que sobrou dispara em `request.all()` / `body()` / `except()`, que
enumeram nada. **Dispara zero vezes nas quatro apps.** É o resultado certo.

O critério que faltava escrever está agora em `architecture.md`: regra só entra no
pacote se sai do padrão, da linguagem, ou de uma API publicada. O que sai de como
um time escreve código vai para o config.
