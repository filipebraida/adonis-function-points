# Achados do spike

Spike descartável executado contra uma aplicação AdonisJS de produção, antes
de escrever o pacote.

A aplicação medida é privada; identificadores foram anonimizados aqui. O que
importa são as proporções, não os nomes. Porte: 32 models (317 colunas),
164 rotas, 71 validators, 12 módulos de domínio, ~1100 arquivos TS.

Os scripts ficam fora do versionamento (`.local-spikes/`), porque embutem
caminhos e nomes internos da aplicação medida.

## Resultado

| | PF | confiabilidade |
|---|---|---|
| Funções de dados (29 ALI/AIE) | 203 | **alta** — sai direto dos `@column`, quase sem heurística |
| Funções transacionais (159) | 641–687 | média — depende da detecção de escrita |
| **Total não ajustado** | **844–890** | |

Duas implementações independentes (v1 nível de arquivo, v2 nível de método)
deram totais a 5% um do outro apesar de classificarem as transações de forma
bem diferente.

**Consequência de design:** o total em PF é muito mais estável que a
classificação individual, porque EE-baixa=3 e SE-baixa=4 são próximos. Isso é
ótimo para faturamento agregado e ruim para defender função a função numa
auditoria — e é a justificativa central do comando `fp:explain`.

## O que é fácil

Funções de dados. Model Lucid dá nome, tabela, atributos e relações sem
ambiguidade. `@column` sem `isPrimary` é DET. Essa parte é praticamente
determinística e responde por ~24% do total.

## O que é difícil

**Detecção de escrita é o parâmetro crítico do projeto.** Ela decide EE vs SE
em ~40% das transações.

> **Conclusão retirada.** Este documento afirmava que "a poda de ARs move o
> total só 2–7%". O número foi medido com o rastreamento quebrado (FTR médio
> 1,36), ou seja, com poucos ARs para podar. Não sustenta a conclusão. A
> sensibilidade à poda será medida de novo quando o grafo funcionar.

Progressão medida da detecção de escrita, sobre 159 transações:

| estratégia | transações com escrita detectada | concordância com o verbo HTTP |
|---|---|---|
| só o corpo do controller | 20 | 44% |
| + seguir `new Action().handle()` | 45 | 60% |
| nível de arquivo (contamina) | 124 | 76% (falso) |

Das 63 divergências restantes entre verbo HTTP e AST:
- **61 são falha de rastreamento** — corrigível, é trabalho de grafo de chamadas
- **2 são o AST estando certo** — um `POST .../export` que só lê e devolve um
  PDF gerado; pelo AFP é SE, não EE

Ou seja: **o verbo HTTP não é gabarito**, e a regra do AFP funciona. O que
precisa de trabalho é seguir a chamada até onde a escrita acontece.

### Nível de arquivo não funciona

Na app medida havia um service de domínio com 38 escritas. Qualquer controller
que o importe vira EE, mesmo chamando só um método de leitura — e serviços
assim são a norma, não a exceção. A detecção tem que ser no call site,
dentro do corpo do método alcançável — nunca "este arquivo contém uma escrita".

### Padrões de código que precisam ser resolvidos

AdonisJS não impõe organização. Cada um destes aparece em apps reais e precisa
de uma estratégia registrável (ver `src/inventory/resolvers/`):

```ts
await User.create(payload)                  // controller gordo
await new CreateUser().handle(payload)      // action object      [implementado]
const a = new CreateUser(); await a.handle() // action em variável [implementado]
await UserService.create(payload)           // service estático
await this.users.create(payload)            // injetado — exige type checker
await CreateUserJob.dispatch(payload)       // job — decisão de contagem em aberto
await db.table('users').insert(payload)     // query builder puro
```

Chamada que nenhuma estratégia resolve **entra em `unresolved` e aparece no
relatório de cobertura**. Nunca deve ser silenciosamente tratada como leitura —
isso produziria um número que parece certo e está errado.

## Armadilhas de parsing (já pagas)

1. **Rotas são multi-linha.** O código real é:
   ```ts
   router
     .get('/orders/:uuid', [...])
   ```
   O texto da expressão contém a quebra de linha, então `^router\.(\w+)$` não
   casa. Sem normalizar whitespace eu enxergava 23 de 164 rotas.

2. **Nomes de controller colidem.** No `.adonisjs/server/controllers.ts` gerado
   havia 5 colisões de nome simples entre módulos diferentes — dois módulos com
   um `Dashboard`, por exemplo. Indexar por caminho pontuado
   (`<modulo>.web.<Controller>`), nunca por nome simples, e resolver os aliases
   de `const { web, api } = controllers.<modulo>`.

3. **Cobertura de rotas: 162/164.** As que faltam são closures inline sem
   controller. Aceitável, mas tem que ser reportado, não escondido.

4. **Falsos positivos de escrita já identificados:**
   - `.related('x')` é acessor de relação, usado para ler e para escrever
   - `.create(` casa com `vine.create(` e com vários builders
   - `.query(...).update(` com regex frouxo atravessa código não relacionado
   - instância em minúscula (`purchaseOrder.save()`) não casa com o nome do
     model (`PurchaseOrder`) se a comparação for sensível a caixa

## Divergências esperadas contra contagem manual

Do estudo de caso do Ligeiro (Pinel, 2012): **52 PF automático vs 56 PF manual,
~7% de desvio**, com divergências sistemáticas:

- mensagens de erro/confirmação contam 1 DET na contagem manual e são invisíveis
  para análise estática — em um caso isso cruzou a faixa de complexidade
- ARs contados por dependência de código ficam maiores que a visão do usuário
  (3 FDs no código vs 1 que o contador humano reconhece)
- SE vs CE é indecidível estaticamente (depende de haver cálculo ou dado
  derivado); o AFP resolve colapsando tudo em SE
- RET aproximado em 1: subgrupo lógico reconhecido pelo usuário não é derivável

Erro sistemático se calibra. É a justificativa do `fp:calibrate`.

## Referências

- OMG *Automated Function Points* 1.0 / ISO-IEC 19515 — regras normativas
- Pinel, R. E. A. *Análise de Pontos de Função em Sistemas Desenvolvidos Usando
  MDA*. COPPE/UFRJ, 2012 — ferramenta Ligeiro, estudo de caso de referência
- Vazquez, Simões, Albert (2011) — contagem manual usada como gabarito (56 PF)
