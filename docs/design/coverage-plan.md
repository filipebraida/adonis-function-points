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

## Projeção

Quantas transações ficam completamente limpas a cada fase:

|                                      | cobertura | ganho          |
| ------------------------------------ | --------- | -------------- |
| hoje                                 | 53,2%     | —              |
| fase 1 — filtro de ruído             | 64,9%     | +22 transações |
| fase 2 — injeção por valor default   | 69,7%     | +9             |
| fase 3 — fronteira de `node_modules` | **86,2%** | +31            |

As três juntas passam de 0,85, que é onde o portão começa a valer. **Nenhuma
delas sozinha chega lá** — e a fase 3, a mais cara, é também a que mais rende.

## Fase 1 — o filtro de pendência

O que nunca deveria ser reportado:

- serviço do framework, mesmo alcançado por alias da aplicação (`env`, `health`,
  `hash`, `mail`, `drive`, `emitter`, `logger`)
- método de tipo nativo: `Map`, array, `Date`, luxon
- método herdado do Lucid que não é acesso — `useTransaction`, `serialize`,
  `refresh`, `toJSON`
- `.validate()` de validator VineJS

**Invariante desta fase: nenhum ponto de função pode se mover.** Pendência não
entra na contagem, só na cobertura — então se o total mudar, o filtro removeu
algo que era acesso a dado de verdade. As quatro apps de produção são a
verificação, e o benchmark Vazquez tem que continuar em 46.

O risco desta fase é silenciar demais, que é o defeito que este pacote existe
para não cometer. Mitigação: a lista é de formas _conhecidas_, nunca um
`catch-all`; o que não casar continua sendo reportado.

## Fase 2 — injeção por valor default

```ts
constructor(private billing = new BillingService()) {}
```

Propriedade de construtor com valor default e **sem anotação de tipo** —
injeção sem container. O `injectedFor()` lê só `getTypeNode()`, que aqui é
`undefined`, então não enxerga nada. Mas `new BillingService()` está no AST, e
é exatamente o que o `action-object` já sabe ler.

Esta fase **pode mudar a contagem**, e legitimamente: seguir o service pode
revelar escrita que hoje não é vista, virando EE o que era SE. O efeito tem que
ser medido nas quatro apps, não presumido.

## Fase 3 — fronteira de `node_modules` (decisão §4)

Os 47 transformers e as 31 chamadas encadeadas são o mesmo padrão: o método
vem de uma base que mora em pacote. A decisão §4 já prevê entrar **um nível**
para dentro do pacote, marcando `vendor: true`, e nunca além.

É a fase mais cara e a que mais rende. Também é a que mais pode mudar a
contagem, porque uma base de transformer pode ler dado.

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
