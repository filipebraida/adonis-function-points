# Benchmark Vazquez — gabarito e escolhas de transcrição

Estudo de caso de **Vazquez, Simões e Albert (2011)**, com contagem manual
publicada. Usado como gabarito pela dissertação do Ligeiro (Pinel, COPPE/UFRJ,
2012), que o contou automaticamente a partir de modelos MDArte.

É o único benchmark externo deste projeto: uma contagem que não foi feita por
nós, sobre uma especificação que não escrevemos.

## O sistema

Registro de ponto. O trabalhador registra entradas e saídas, justifica quando
esquece de registrar ou quando altera um registro, e consulta suas horas. Cada
trabalhador vê só os próprios dados. O gerente emite relatório de presença de
todos.

## Gabarito: 46 PF não ajustados

Coluna "VAZQUEZ et al. (2011)" da Tabela 6.7 da dissertação.

| função | tipo | AR/TR | TD | complexidade | PF |
|---|---|---|---|---|---|
| Pessoa | AIE | 1 | 4 | baixa | 5 |
| Justificativa | ALI | 1 | 3 | baixa | 7 |
| Apontamento | ALI | 1 | 4 | baixa | 7 |
| Consulta Apontamento Diário | CE | 1 | 5 | baixa | 3 |
| Registro de Ponto | EE | 1 | 3 | baixa | 3 |
| Alteração de Apontamento | EE | 2 | 5 | média | 4 |
| Exclusão de Apontamento | EE | 2 | 2 | baixa | 3 |
| Apontamento c/ Justificativa | EE | 2 | 5 | média | 4 |
| Emitir Relatório de Presença | SE | 3 | 9 | média | 5 |
| Acompanhar Presença | SE | 3 | 10 | média | 5 |
| **total** | | | | | **46** |

Funções de dados 19, transacionais 27.

### Como o número foi apurado, e a correção que exigiu

Este documento afirmava 56 PF em versões anteriores. Estava errado.

A extração do PDF interleava o número da página entre os dois totais da Tabela
6.5, e o número da página foi lido como se fosse o gabarito. O texto da própria
dissertação desfaz a ambiguidade: *"os valores totais calculados pelas
abordagens são diferentes, tendo o processo automático obtido o maior valor"* —
o automático (Ligeiro) é 52, logo a referência é **menor** que 52.

Somando a coluna de Vazquez à mão: 19 + 27 = 46. E a Tabela 6.7 exibe o mesmo
padrão de interleaving (`Total 43 / [página 61] / Total 46`), o que confirma a
leitura.

## Referências para comparação

| contagem | total | vs gabarito |
|---|---|---|
| Vazquez et al., manual publicada | 46 | — |
| Ligeiro, automática sobre modelos MDArte | 52 | +13% |
| manual seguindo as regras do Ligeiro | 43 | −6,5% |

## Divergências que o próprio Ligeiro documentou

Três grupos, e as três se aplicam a qualquer contador automático:

1. **Mensagens ao usuário** valem 1 DET na contagem manual e são invisíveis para
   análise estática. Produz −1 DET por transação, o que às vezes cruza a faixa
   de complexidade.
2. **ARs contados por dependência de código** ficam maiores que a visão do
   usuário. Em "Registro de Ponto", o código usa 3 funções de dados e o contador
   humano reconheceu 1.
3. **SE vs CE** é indecidível estaticamente, porque depende de haver cálculo ou
   dado derivado.

## Divergências esperadas do NOSSO contador

Previstas antes de rodar, e são da norma, não defeitos:

- **CE colapsado em SE** (AFP §6.5.3, explícito). "Consulta Apontamento Diário"
  é CE de 3 PF no gabarito; como SE com 1 FTR e 5 DET, vale 4. **+1 PF.**
- **Mensagens não contadas** (`messageDet: 0`, default AFP): −1 DET por
  transação, o que pode reduzir complexidade em casos limítrofes.
- **DETs de saída pela tabela lida inteira** quando não há `select` nem
  transformer visível (counting-decisions §6): tende a **superestimar**.

## Escolhas de transcrição

A especificação é de casos de uso e telas; virou uma app AdonisJS. Cada escolha
abaixo pode mover o número, então fica registrada **antes** de comparar:

| decisão | escolha | por quê |
|---|---|---|
| `Pessoa` fora da fronteira | model sem escrita pela app | o gabarito a classifica como AIE: é parte do controle de acesso |
| DETs de `Pessoa` | 4 atributos não identificadores | bate com os 4 TDs do gabarito |
| DETs de `Justificativa` | 3 | idem |
| DETs de `Apontamento` | 4 | idem |
| campos de entrada | um validator VineJS por transação de escrita | é onde a app declara o que o usuário informa |
| relatórios | leitura com `preload`, sem transformer | o gabarito conta 9 e 10 DETs, ou seja, campos de várias entidades |
| "Efetuar Login" | **fora** | a dissertação o excluiu da comparação, porque o MDArte o gerava |
| "Registrar Justificativa" | transação própria | o gabarito a conta separada ("Apontamento c/ Justificativa"); só o Ligeiro a agregou |

**O que NÃO foi feito:** nenhuma escolha de transcrição foi ajustada depois de
ver o resultado do contador. A fixture e este documento entram em commit próprio,
e o resultado da comparação entra no commit seguinte — qualquer que seja.
