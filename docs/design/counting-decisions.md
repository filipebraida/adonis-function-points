# Decisões de contagem

Casos que a análise estática levanta e o que decidimos para cada um, com a
regra normativa que sustenta. Fonte: **OMG Automated Function Points v1.0**
(ISO/IEC 19515), que é o que este pacote implementa.

Quando o AFP e a intuição divergem, vale o AFP — é ele que torna a contagem
defensável.

---

## 1. Rota que não alcança dado nenhum

Exemplo: `router.on('/sobre').renderInertia('portal/sobre')` — página estática,
sem handler. Aparece em 3 das 6 aplicações levantadas.

**Decisão: não conta.**

> "To identify the transaction start and finish, the static code analyzer shall
> assume that the code contains a complete transaction whenever it can show one
> or several code paths from the user interface down to the data entities."
> — AFP §6.5.3

Sem caminho até uma função de dados, não há transação a identificar. O AFP
tipifica as transações "through the detection of the transaction's actions made
on the identified internal data entities" — sem entidade tocada, não há o que
classificar. O IFPUG concorda por outro caminho: uma CE exige recuperação de
dado de ALI/AIE.

**O melhor da decisão é que não precisa de caso especial.** Não é uma regra
sobre `router.on`; cai naturalmente de "rastreie até os dados". Qualquer rota
que não chegue a dado nenhum fica de fora, seja qual for a forma dela.

**Mas tem que aparecer no relatório.** "Não alcançou dado nenhum" significa
duas coisas muito diferentes: a rota é legitimamente estática, ou o rastreador
falhou. As duas precisam ser visíveis, e o AFP exige isso:

> "If the transaction execution depends on code that is unknown or unavailable
> to the automated tool, the code end point shall be cataloged and listed in the
> generated report in order to detect and quantify the missing patterns and
> libraries for the specific count process." — AFP §6.5.3

---

## 2. Rotas registradas por pacotes de terceiros

Exemplo: `transmit.registerRoutes(...)`, rotas de métricas, `drive.fs.serve`.

**Decisão: não contam.**

O AFP exige que a transação cruze a fronteira da aplicação e seja reconhecível
pelo usuário. Canal de SSE e servidor de arquivos são infraestrutura.

Na prática **nem precisa de lista de exclusão**: pela regra 1, essas rotas não
alcançam funções de dados da aplicação e já saem sozinhas. A lista em
`boundary.ignoreEntryPoints` fica como rede de segurança e para deixar a
intenção explícita no relatório, não como mecanismo principal.

---

## 3. Escrita em hook de model (`@afterCreate`, `@beforeSave`…)

Presente em 4 das 6 aplicações levantadas.

**Decisão: o hook pertence à transação que o disparou. Nunca é transação
própria.**

Um processo elementar é, pelo IFPUG, "the smallest unit of activity which is
meaningful to the user, that constitutes a complete transaction, it is
self-contained and leaves the business of the application in a consistent
state" — e precisa **cruzar a fronteira**. Um hook não cruza fronteira nenhuma:
ele dispara dentro de uma transação que já cruzou.

O AFP manda agregar tudo que a transação alcança:

> "Each transaction shall be traced using static code analysis in order to
> capture all the data functions involved, the DETs involved, and the actions
> performed by the transaction on these data functions. When the static code
> analyzer finds multiple optional paths in the context of a transaction, it
> shall consider these multiple optional paths to be part of the same
> transaction in order to capture all data functions handled." — AFP §6.5.3

**Consequência de implementação, e não é pequena:** quando o grafo de chamadas
chega a uma escrita num model, o rastreador tem que **entrar também nos hooks
daquele model**, porque eles fazem parte do mesmo caminho. Escrita em hook
conta como acesso da transação que disparou, soma FTR, e faz da tabela alvo um
ALI mantido pela aplicação.

Ignorar hooks subconta FTR e pode deixar uma tabela classificada como AIE
quando na verdade é ALI.

---

## 4. Mixins e pacotes que alteram o model

Exemplo: `class User extends compose(UserSchema, Auditable)`.

**Decisão: a ferramenta descobre; não existe lista de pacotes conhecidos.**

Essa é a regra certa porque qualquer pacote pode mudar a forma de um model.
Hoje é `Auditable`; amanhã é soft-delete (acrescenta `deletedAt`),
multi-tenancy (acrescenta `tenantId`), versionamento. Uma lista de exceções
estaria desatualizada na semana seguinte.

### Colunas: o schema gerado já resolve

`database/schema.ts` é gerado das migrations, então reflete as colunas que
**de fato existem no banco** — independentemente de quem as criou. Um mixin que
acrescenta coluna via migration própria aparece lá; uma propriedade transiente
não aparece, e corretamente.

Verificado no `@filipebraida/adonis-auditing`: o mixin `Auditable` não declara
nenhum `@column`. O que ele acrescenta é comportamento (`$isAuditDisabled`,
`auditComment`, métodos) e os dados vão para uma tabela separada, criada pela
migration do próprio pacote. Zero DET acrescentado ao model hospedeiro — e o
schema gerado chega a essa conclusão sozinho, sem o pacote saber o que é
auditoria.

### Tabelas de pacote: filtro de dados técnicos

O problema que sobra é o inverso: a tabela `audits` **existe** e apareceria como
ALI. O AFP prevê isso:

> "Some data tables, namely temporary data tables and technical data tables, are
> ignored in the sizing process in order to match the automated counting process
> with IFPUG rules. Database tables identified as temporary or technical shall
> be marked as such to be presented in the final report, and shall be ignored in
> the rest of this process." — AFP §6.5.2.1.1

O AFP oferece dois mecanismos, e nós acrescentamos um terceiro, melhor:

1. **Estrutura de lookup** (§6.5.2.1.2): uma PK, no máximo um inteiro de ordem,
   nenhuma relação de cascade delete apontando para ela, menos de três atributos
   de texto ou nomes casando com `name|message|type|code|description|label`.
2. **Convenção de nome** (§6.5.2.1.3), configurável, com defaults do próprio
   spec: `^(.+temp|.*session.*|.*error.*|.*search.*|.*login.*|.*logon.*|.*filter.*)$`,
   `^(.+status)$`, `^(lkp_.+|.+types?|.+_t)$`.
3. **Origem da escrita** — nosso: se **toda** escrita numa tabela nasce dentro
   de código de pacote (`node_modules`) e nenhuma nasce em código da aplicação,
   a tabela é infraestrutura daquele pacote, não função da aplicação.

O terceiro é o que atende de verdade o "ele tem que descobrir": não depende de
nome, não depende de lista, e funciona para pacote que ninguém previu.

### A regra de fechamento do AFP

E existe uma rede de segurança normativa acima de todas:

> "If a Data Function is not used in any of the processing of an application's
> Transactional Functions, the Data Function shall not be counted in the
> application." — AFP §6.5.4

Tabela que nenhuma transação da aplicação toca simplesmente não entra. Isso
elimina sozinha boa parte das tabelas de infraestrutura, sem regra nenhuma.

---

## Consolidando: o que essas decisões têm em comum

Três das quatro se resolvem pela **mesma** regra — rastrear a transação até as
funções de dados e contar o que ela alcança. Rota estática cai fora porque não
alcança; rota de terceiro cai fora porque não alcança; hook entra porque está no
caminho; tabela órfã cai fora porque ninguém a alcança.

Isso é um bom sinal de que o desenho está no eixo certo: **o grafo
transação → dados é a espinha da contagem**, e o resto é filtro de borda.

Também reforça a prioridade já identificada no spike: a qualidade do pacote é a
qualidade desse rastreamento. É onde o esforço tem que ir.

---

## 5. Identidade de uma função entre versões (`fp:diff`)

É a decisão que toca dinheiro: num contrato por demanda, o que se fatura é
inclusão / alteração / exclusão entre duas versões. Se uma rota renomeada vira
"exclusão + inclusão", fatura em dobro; se uma alteração real passa como "sem
mudança", não fatura. A identidade **restringe o formato do inventário** desde a
Fase 2, por isso é decidida antes de existir o diff.

**Base normativa: OMG Automated Enhancement Points 1.0** — a spec irmã do AFP,
feita exatamente para medir manutenção entre duas revisões.

> "Each Artifact shall be analyzed in both revisions to determine whether it is:
> Added — when it exists in revision ToRevision while it didn't exist in
> FromRevision. […] Modified — when it exists in both revisions but whose source
> code changed between revision FromRevision and ToRevision." — AEP §6.3

> "A modified transaction exists when one or more of the computational objects
> in its Implementation Scope is modified, added to the processing flow, or
> removed from the processing flow. Computational object modification status is
> based on their source code checksum." — AEP §6.5

A AEP define também *split* e *merge* de entidades de dados (pelos DETs que
migram de uma para outra) e *mudança de tipo* (ALI ↔ AIE), e pondera cada caso
por um **Complexity Factor**: adicionada = 1; excluída = 0,4; modificada entre
0,25 e 1,75 pela Tabela 6.1, com teto de 0,25–0,75 quando o que mudou é
artefato compartilhado.

### Decisão

**Identidade de função transacional = identidade do ponto de entrada**, nunca
da implementação:

| tipo | chave |
|---|---|
| HTTP | `(verbo, padrão normalizado)` — parâmetros anonimizados (`/books/:id` ≡ `/books/:uuid`), prefixos de grupo aplicados, barra final removida |
| comando ace | `commandName` |
| job / listener agendado | nome da classe |

**Não** é o nome da rota (`.as()` é opcional e cosmético — renomear não muda a
função que o usuário vê) nem o caminho do controller (é implementação: mover
`books_controller.ts` de módulo não altera a função).

**Identidade de função de dados = nome físico da tabela.** É de onde o AFP
deriva a função de dados. Split/merge detectados como na AEP: se a maioria dos
DETs de uma tabela aparece em outra na revisão seguinte, é split/merge, não
exclusão + inclusão.

**Modificação = mudança no checksum do escopo de implementação**, como na AEP,
com um refinamento deliberado: o checksum é do **AST normalizado** dos corpos
alcançados (sem whitespace, sem comentários), não dos bytes do arquivo. Rodar o
prettier não pode virar fatura.

**Renomeação de URL** é mudança visível ao usuário e conta como exclusão +
inclusão — mas o relatório marca como `possível renomeação` quando o escopo de
implementação é idêntico ao de uma função excluída, para o contador humano
decidir. É o único caso em que a ferramenta sugere em vez de afirmar.

**Fatores por tipo de mudança** são configuráveis, com a AEP como default. O
Roteiro de Métricas do SISP usa fatores próprios para inclusão/alteração/
exclusão; entra como *preset* nomeado, com os valores conferidos contra a versão
do roteiro em vigor no contrato — não de memória.

### O que o inventário passa a carregar

- `EntryPoint.identity`: a chave acima, calculada na coleta
- `HandlerBehavior.scope`: lista de `{ file, member, bodyHash }` alcançados
- `DataStore.table` e os nomes dos DETs (para split/merge)

---

## 6. DETs de saída (SE / CE)

Com Inertia, o que sai é `inertia.render('page', props)`. Model serializado
inteiro? Só o que a tela mostra? Só o transformer? Sem decisão, toda SE tem DET
inventado.

**Base normativa: o AFP conta DET de transação pelos campos de dados usados, não
pelo que é renderizado.**

> "A data function shall be identified as used if any of its tables or table
> fields are used. Each data function (ILF or EIF) shall be identified as a File
> Type Referenced (FTR) and each table field shall be identified a Data Element
> Type (DET). […] Count only one DET for each unique field that is required to
> complete the Output Transaction. If a DET both enters and exits the boundary,
> count that DET only once." — AFP §7.3

E o AFP é explícito sobre a prioridade quando isso diverge do contador humano:

> "This specification prioritizes repeatability and consistency over consistency
> with the IFPUG CPM counting guidelines." — AFP §6.1

### Decisão

DETs de uma SE = **união dos campos distintos dos data stores lidos no escopo de
implementação**, estreitada pelo que for estaticamente visível:

| o código faz | DETs |
|---|---|
| `Book.query()` / `selectFrom('books').selectAll()` | todas as colunas de `books` |
| `.select(['title', 'isbn'])` | só as selecionadas |
| `.preload('author')` / join | + colunas do relacionado |
| passa por transformer / DTO que lista campos | **as chaves do transformer** — é o que cruza a fronteira |
| prop escalar derivada (`total`, `canEdit`) | 1 DET cada — dado derivado saindo da fronteira |
| campo que entra e sai (filtro ecoado na tela) | conta uma vez |

**Divergência conhecida e aceita:** o contador humano conta os campos *exibidos*;
sem `.select()` nem transformer, nós contamos a tabela inteira e superestimamos.
É a troca que o AFP faz de propósito — repetibilidade sobre fidelidade — e vai
para o `Rationale` de cada função como `detSource: 'all-columns'` vs
`'transformer'` vs `'select'`, para o `fp:calibrate` medir o viés por origem.

**Mensagens de erro/confirmação:** o IFPUG manual conta +1 DET; o AFP não. Segue
o AFP. O estudo do Ligeiro mostrou que essa é a divergência sistemática de −1 DET
por transação; fica como `messageDet: 0 | 1` na config, para calibração, com
default 0.

---

## 7. DETs para tipos compostos (entrada)

Validators VineJS e tipos do registry têm objeto aninhado, array, union, spread.
O spike usou "+3 para spread" — chute, e chute é o que este pacote existe para
eliminar.

**Base normativa:**

> "A data element type is a unique user recognizable, non-repeated attribute
> that is part of an ILF, EIF, EI or EO." — AFP §4, citando ISO/IEC 20926
>
> "Count only one DET for each unique field that is required to complete the
> External Input." — AFP §7.3

E a regra IFPUG para grupo repetitivo: DET recursivo conta só na primeira
ocorrência.

### Decisão

| forma no validator / tipo | DETs | por quê |
|---|---|---|
| campo escalar | 1 | atributo único |
| `vine.object({ a, b })` aninhado | folhas contadas individualmente | o usuário preenche cada uma |
| `vine.array(vine.string())` | 1 | grupo repetitivo de um atributo |
| `vine.array(vine.object({ a, b }))` | folhas do objeto, **uma vez** | grupo repetitivo conta na primeira ocorrência |
| `vine.enum(...)` / union | 1 | um atributo com domínio |
| `.optional()` / `.nullable()` | 1 | o campo existe |
| parâmetro de rota (`:id`) | 1 cada | entrada exigida para completar |
| upload de arquivo | 1 | um atributo |
| `...base.getProperties()` (spread) | folhas do `base`, **resolvido** | se não resolver, conta **0 e entra em `unresolved`** — nunca chuta |
| campo que entra e sai | 1 | AFP §7.3 |
| botão/comando de submissão | 0 | IFPUG manual conta 1; AFP não. Config `commandDet`, default 0 |

Com Tuyau presente, o `body` do registry é a mesma árvore já resolvida (spread
inclusive) e prevalece sobre o AST do validator. As duas fontes têm que dar o
mesmo número — é um teste da Fase 3.
