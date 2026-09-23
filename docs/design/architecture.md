# Arquitetura

## Duas camadas, deliberadamente separadas

```
src/inventory/   fatos crus da aplicação — NÃO conhece APF
src/albrecht/    regras IFPUG/AFP aplicadas sobre o inventário
```

**Regra inegociável:** `src/inventory/**` nunca importa de `src/albrecht/**`.

O inventário não sabe o que é um ALI. É isso que permite, se as métricas
estatísticas crescerem, extrair a camada de inventário para um pacote próprio
sem reescrever nada — e o contador de PF vira só mais um consumidor dela.

Enquanto isso não acontecer, **um repo flat, um pacote publicado**, igual ao
`adonis-auditing`. Nada de monorepo preventivo.

## Por que "Albrecht"

Allan J. Albrecht inventou a APF na IBM em 1979; o IFPUG só foi fundado em 1986
para padronizar o método dele. Mas o nome aqui não é homenagem decorativa: a
literatura de medição funcional usa "Albrecht function points" para distinguir
da linhagem COSMIC, que conta movimentos de dados e produz números
incompatíveis. Se um dia houver `src/cosmic/`, a separação já está nomeada.

## Fontes de dados: runtime + estático

A dissertação do Ligeiro precisou de modelos UML (AndroMDA) porque não tinha
acesso ao runtime da aplicação. Nós temos, e isso muda o custo de tudo:

| Fato | Origem | Confiabilidade |
|---|---|---|
| rotas, métodos, padrões, handlers | `router.toJSON()` em runtime | exata |
| colunas e tipos dos models | `Model.$columnsDefinitions` | exata |
| relações e cardinalidade | `Model.$relationsDefinitions` | exata |
| tabelas físicas | migrations (AST) | exata |
| DETs de entrada | schema VineJS | quase exata |
| DETs de saída | transformers (AST) | boa |
| escreve ou só lê? | grafo de chamadas (ts-morph) | **heurística — o ponto crítico** |
| FTR/AR | models alcançáveis pelo handler | heurística, precisa de poda |

Regra geral: **runtime para o que não pode errar, AST para o que é
inerentemente heurístico.**

Consequência operacional: o coletor de runtime precisa funcionar com o
container instanciado mas sem conexão de banco, senão não roda em CI. Validar
isso cedo.

## Extensibilidade é requisito, não enfeite

AdonisJS não impõe padrão de organização. A mesma transação pode estar escrita
como controller gordo, action object, service estático, service injetado,
repository, job. Um pacote que só entenda um desses padrões só funciona no
projeto que o originou.

Por isso quatro pontos de extensão, em `src/inventory/resolvers/types.ts`:

- **`CallResolver`** — como seguir de um call site ao próximo corpo
- **`PersistenceDetector`** — o que conta como leitura/escrita de dados
  (separado de propósito: trocar o ORM muda o detector, não o grafo)
- **`DataStoreCollector`** — de onde saem os candidatos a ALI/AIE
- **`EntryPointCollector`** — de onde saem os candidatos a EE/SE/CE

Estratégias registradas em `config/function_points.ts` rodam **antes** das
embutidas.

### Transação não é sinônimo de rota HTTP

Um comando ace que importa uma planilha e um job agendado que sincroniza com
sistema externo são funções transacionais pelo IFPUG. Cada um é um
`EntryPointCollector`. Contar só HTTP subestima o tamanho.

## Rastreabilidade é requisito

Se PF vira fatura, alguém vai contestar um número. Toda função contada carrega
`Rationale`: a regra aplicada, a origem de cada DET, a origem de cada FTR, o
caminho percorrido no grafo, e qualquer override manual **com justificativa
obrigatória**. É o que `fp:explain` imprime.

Sem isso a contagem é um número mágico e ninguém confia.

Corolário: o ruleset é versionado e sai em todo relatório. Contagens só são
comparáveis entre releases se as regras não mudaram no meio — trate o arquivo
de regras como parte do contrato.

## Dizer "não sei" é melhor que errar em silêncio

Chamada que nenhum resolvedor segue entra em `unresolved` e conta na métrica de
cobertura. Se a cobertura cai abaixo de `minCoverage`, a contagem **falha** em
vez de emitir um número que parece certo.

Um total com 40% das chamadas não resolvidas não deveria virar fatura.

## Fases

| fase | entrega | estado |
|---|---|---|
| 0 | scaffold e convenções | feito |
| 1 | coletores → `fp-inventory.json` | próxima, e é a fase cara |
| 2 | motor Albrecht → `fp-count.json` | tabelas prontas |
| 3 | `fp:diff` (inclusão/alteração/exclusão) e CI | — |
| 4 | `fp:calibrate` contra contagem manual | — |
| 5 | métricas estruturais sobre o mesmo inventário | — |

O spike mostrou que a Fase 2 é mais barata do que se estimou (as tabelas IFPUG
são triviais, as funções de dados quase se contam sozinhas) e a **Fase 1 é mais
cara**: precisa de um resolvedor de grafo de chamadas de verdade, não de regex.

## Teste de aceitação

O estudo de caso de Vazquez, Simões e Albert (2011) tem contagem manual
publicada de 56 PF e foi o gabarito da dissertação do Ligeiro. Implementar como
app-fixture em `tests/fixtures/` e assertar o resultado. É o benchmark público
mais direto que existe para validar o motor.
