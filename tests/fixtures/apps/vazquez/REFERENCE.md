# Vazquez benchmark — reference count and transcription choices

Case study from **Vazquez, Simões and Albert (2011)**, with a published manual
count. Used as the reference by the Ligeiro dissertation (Pinel, COPPE/UFRJ,
2012), which counted it automatically from MDArte models.

It is this project's only external benchmark: a count we did not make, over a
specification we did not write.

The system and the function names are Brazilian Portuguese, as published. They
are kept verbatim so every line here can be checked against the source — and so
are the fixture's own file and directory names (`app/ponto/`, `pessoa.ts`,
`apontamentos_controller.ts`). **Do not anglicise them.** The fixture exists to
be compared against a published count function by function; renaming its parts
breaks that correspondence and the comparison stops being verifiable. This is
the one fixture in the repository where Portuguese names are deliberate.

## The system

Time and attendance. A worker records clock-ins and clock-outs, justifies a
missed or amended entry, and checks their hours. Each worker sees only their
own data. The manager issues an attendance report covering everyone.

## Reference: 46 unadjusted FP

Column "VAZQUEZ et al. (2011)" of Table 6.7 in the dissertation.

| function | type | RET/FTR | DET | complexity | FP |
|---|---|---|---|---|---|
| Pessoa | EIF | 1 | 4 | low | 5 |
| Justificativa | ILF | 1 | 3 | low | 7 |
| Apontamento | ILF | 1 | 4 | low | 7 |
| Consulta Apontamento Diário | EQ | 1 | 5 | low | 3 |
| Registro de Ponto | EI | 1 | 3 | low | 3 |
| Alteração de Apontamento | EI | 2 | 5 | average | 4 |
| Exclusão de Apontamento | EI | 2 | 2 | low | 3 |
| Apontamento c/ Justificativa | EI | 2 | 5 | average | 4 |
| Emitir Relatório de Presença | EO | 3 | 9 | average | 5 |
| Acompanhar Presença | EO | 3 | 10 | average | 5 |
| **total** | | | | | **46** |

Data functions 19, transactional 27.

### How the number was established, and the correction it required

This document claimed 56 FP in earlier versions. That was wrong.

The PDF extraction interleaved the page number between the two totals of Table
6.5, and the page number was read as if it were the reference. The
dissertation's own text removes the ambiguity: *"os valores totais calculados
pelas abordagens são diferentes, tendo o processo automático obtido o maior
valor"* (the totals calculated by the two approaches differ, with the automated
process obtaining the higher value) — the automated one (Ligeiro) is 52, so the
reference is **lower** than 52.

Summing the Vazquez column by hand: 19 + 27 = 46. And Table 6.7 shows the same
interleaving pattern (`Total 43 / [page 61] / Total 46`), which confirms the
reading.

## Counts to compare against

| count | total | vs reference |
|---|---|---|
| Vazquez et al., published manual count | 46 | — |
| Ligeiro, automated over MDArte models | 52 | +13% |
| manual following Ligeiro's own rules | 43 | −6.5% |

## Divergences Ligeiro itself documented

Three groups, and all three apply to any automated counter:

1. **User messages** are worth 1 DET in a manual count and are invisible to
   static analysis. This produces −1 DET per transaction, which sometimes
   crosses a complexity band.
2. **FTRs counted by code dependency** come out higher than the user's view. In
   "Registro de Ponto" the code uses 3 data functions and the human counter
   recognised 1.
3. **EO vs EQ** is statically undecidable, because it depends on whether there
   is calculation or derived data.

## Divergences expected from OUR counter

Predicted before the run, and they come from the standard, not from defects:

- **EQ collapsed into EO** (AFP §6.5.3, explicit). "Consulta Apontamento
  Diário" is an EQ worth 3 FP in the reference; as an EO with 1 FTR and 5 DETs
  it is worth 4. **+1 FP.**
- **Messages not counted** (`messageDet: 0`, the AFP default): −1 DET per
  transaction, which can lower complexity in borderline cases.
- **Output DETs taken from the whole table read** when there is no visible
  `select` and no transformer (counting-decisions §6): tends to
  **overestimate**.

## Transcription choices

The specification is written as use cases and screens; it became an AdonisJS
app. Each choice below can move the number, so it is recorded **before** the
comparison:

| decision | choice | why |
|---|---|---|
| `Pessoa` outside the boundary | a model the app never writes | the reference classifies it as an EIF: it belongs to access control |
| DETs of `Pessoa` | 4 non-identifier attributes | matches the reference's 4 DETs |
| DETs of `Justificativa` | 3 | same |
| DETs of `Apontamento` | 4 | same |
| input fields | one VineJS validator per write transaction | it is where the app declares what the user supplies |
| reports | read with `preload`, no transformer | the reference counts 9 and 10 DETs, i.e. fields from several entities |
| "Efetuar Login" | **excluded** | the dissertation excluded it from the comparison, because MDArte generated it |
| "Registrar Justificativa" | its own transaction | the reference counts it separately ("Apontamento c/ Justificativa"); only Ligeiro merged it |

**What was NOT done:** no transcription choice was adjusted after seeing the
counter's result. The fixture and this document land in their own commit, and
the result of the comparison lands in the next one — whatever it turns out to
be.
