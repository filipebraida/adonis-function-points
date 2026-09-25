# transformed_output — reference count

Fixture for counting-decisions §6: the DETs of an output transaction are the
fields that **cross the boundary**, not every column of every table read. The
reference below was written before the code that narrows them, and the total
the current rule set (`afp@1.4.0`) produces is predicted alongside it, so the
difference is known before it is measured.

## The application

A small catalogue. `Livro` has 9 user-recognisable columns and belongs to an
`Autor` with 2. One transaction writes; five read the same data in five shapes,
and the shape is the only thing that differs between them:

| route              | what leaves the boundary                                            |
| ------------------ | ------------------------------------------------------------------- |
| `GET /livros`      | `LivroTransformer.transform(livros)` — 4 keys, one nested transformer |
| `GET /livros/bruto` | the models, untouched                                              |
| `GET /livros/resumo` | `Livro.query().select(['titulo', 'ano'])`, untouched              |
| `GET /livros/:id`  | `new LivroTransformer(livro).forDetalhe()` — spreads `toObject()`, adds 2 |
| `GET /livros/exportacao` | `ExportacaoTransformer` — spreads `serialize()`, which cannot be read |
| `GET /autores`     | `Autor.query().select('nome')`, untouched                           |
| `POST /livros`     | validator with 3 fields, writes `Livro`                              |

## Reference: 41 unadjusted FP

| function            | type | FTR/RET | DET | complexity | FP  | DET origin                                       |
| ------------------- | ---- | ------- | --- | ---------- | --- | ------------------------------------------------ |
| Livro               | ILF  | 1       | 9   | low        | 7   | columns, minus `id`                              |
| Autor               | EIF  | 1       | 2   | low        | 5   | columns, minus `id`                              |
| GET /livros         | EO   | 2       | 4   | low        | 4   | `titulo`, `isbn`, `autor.nome`, `autor.totalLivros` |
| GET /livros/bruto   | EO   | 2       | 11  | average    | 5   | every column of both stores                      |
| GET /livros/resumo  | EO   | 1       | 2   | low        | 4   | `titulo`, `ano`                                  |
| GET /livros/:id     | EO   | 2       | 7   | average    | 5   | `:id` + the 4 above + `resumo`, `paginas`        |
| GET /livros/exportacao | EO | 1      | 2   | low        | 4   | `formato` + 1 opaque spread, **reported**        |
| GET /autores        | EO   | 1       | 1   | low        | 4   | `nome`                                           |
| POST /livros        | EI   | 1       | 3   | low        | 3   | `titulo`, `isbn`, `autorId`                      |
| **total**           |      |         |     |            | **41** |                                               |

## Rules the reference applies

1. **A transformer on the path decides the output.** Its DETs are the keys of
   the object literal `toObject()` returns; a nested transformer contributes its
   own keys once; an array of scalars (`titulares.map((t) => t.nome)`) is one
   DET, as a repeating group. When a transformer is present, the columns of the
   stores read are **not** added on top — what the transformer does not emit
   does not leave the boundary.
2. **`...this.pick(this.resource, [...])`** contributes the listed names.
   **`...this.toObject()`** contributes the keys of the body it spreads, which
   the graph already follows. Any other spread (`...this.resource.serialize()`,
   `...this.extras`) is unreadable: it counts **1 DET as a floor** and is
   reported in the confidence block — the same treatment an open `vine.object`
   gets on the input side (counting-decisions §9). Zero would make an
   unreadable output cheaper than a single plain field, which is the wrong
   direction for a number that becomes an invoice.
3. **A key that is the identifier of the transformer's resource** (`id` on
   `BaseTransformer<Livro>`) is not a DET, for the same reason `isPrimary` is
   not one on the data function: the user does not recognise a surrogate key.
4. **`.select([...])` or `.select('a', 'b')`** on a store narrows that store's
   output columns to the ones named. Only string literals count; a computed
   list is unreadable and falls back to every column, reported.
5. **Nothing visible** → every non-identifier column of every store reached,
   marked `output:` in the rationale. This is the `afp@1.4.0` behaviour and it
   overestimates on purpose (AFP §6.1: repeatability over fidelity).
6. Route parameters and validator fields are input DETs and count as before.

## What `afp@1.4.0` says, predicted

Every read transaction is counted from the whole tables, so:

| function           | 1.4.0 DET | 1.4.0 FP | reference FP |
| ------------------ | --------- | -------- | ------------ |
| GET /livros        | 11        | 5        | 4            |
| GET /livros/resumo | 9         | 4        | 4            |
| GET /livros/:id    | 12        | 5        | 5            |
| GET /livros/exportacao | 9     | 4        | 4            |
| GET /autores       | 2         | 4        | 4            |

Predicted 1.4.0 total: **42 FP** (+1). Only one of the five reads moves: an EO
with 1 FTR is low up to 19 DETs, and with 2 FTRs it is average from 6. That is
the granularity effect counting-decisions §7 describes — DETs change far more
often than the points do — and it is why the fixture asserts DETs, not only FP.

The first draft of this table predicted 39 over six transactions, grading
`GET /livros/resumo` as average. The counter was run once, before any code
changed, to check that the fixture parses with full coverage; it printed 38,
and the arithmetic above was corrected. The reference column was not touched.
`GET /livros/exportacao` was added afterwards, still before any code, because
the rule for an unreadable spread needed a case that exercises it.

## Transcription choices

- `Autor` is read and never written, so it is an EIF under §6.5.4 — the point of
  the fixture is the output side, and an EIF keeps the data half small.
- `forDetalhe()` is reached through `new LivroTransformer(livro).forDetalhe()`,
  the `action-object` shape, so the fixture also proves that a transformer method
  other than `toObject` is read when the graph reaches it.
- No `autoCreate`/`autoUpdate` timestamps on purpose: their treatment is a
  separate decision with its own fixture.
