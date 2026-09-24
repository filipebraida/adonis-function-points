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

Não persegue 100%. As 5 pendências indeterminadas (`this.redis.*`,
`this.authz.can`) são exatamente o que o AFP §6.5.3 manda catalogar e reportar
— elas _devem_ continuar visíveis. Um rastreador que reporta zero pendências ou
é perfeito ou está mentindo, e o segundo é mais provável.
