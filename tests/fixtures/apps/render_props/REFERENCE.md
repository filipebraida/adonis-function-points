# render_props — reference count

Fixture for plan 0.7 §A′: the DETs of an output are what the transaction
**delivers** — the props handed to `inertia.render` / `inertia.modal` /
`view.render` / `response.json|ok|created|send` — not every column of every
store it touched along the way. Written before the code.

## The application

| store        | columns (besides `id`)                          | role                                                            |
| ------------ | ----------------------------------------------- | --------------------------------------------------------------- |
| `Produto`    | `nome`, `preco`, `estoque`, `categoria`, `fornecedorId` | written by `POST /produtos`: ILF                        |
| `Fornecedor` | `nome`, `cidade`                                | read through the preload and a dropdown: EIF                    |
| `Usuario`    | `nome`, `papel`                                 | read to **authorise** in `show`, never delivered: EIF, and no output DET anywhere |

Six transactions, each one shape of delivery:

| route                     | delivery                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /produtos`           | `produtos` from a query object; `total: produtos.length`; `filtros: { busca, ativo }` echoing the inputs |
| `GET /produtos/:id`       | `produto` bound to `Produto.findOrFail`; `podeEditar` derived; `Usuario` read but not delivered |
| `GET /produtos/resumo`    | props by identifier → a query object that **returns a literal** with a `.map`                   |
| `GET /produtos/exportar`  | `response.send(gerarCsv(produtos))` — a document the analysis cannot read                       |
| `GET /produtos/:id/editar`| `inertia.modal` with a transformer and a `.map((f) => ({ id, nome }))`                          |
| `POST /produtos`          | validator with 4 fields, writes `Produto`                                                       |

## Reference: 43 unadjusted FP

| function                   | type | FTR/RET | DET | complexity | FP     | DET origin                                                                 |
| -------------------------- | ---- | ------- | --- | ---------- | ------ | -------------------------------------------------------------------------- |
| Produto                    | ILF  | 1       | 5   | low        | 7      | columns, minus `id`                                                        |
| Fornecedor                 | EIF  | 1       | 2   | low        | 5      |                                                                            |
| Usuario                    | EIF  | 1       | 2   | low        | 5      |                                                                            |
| GET /produtos              | EO   | 2       | 10  | average    | 5      | `busca`, `ativo` (in) + Produto 5 + Fornecedor 2 (what the query object reads) + `total` |
| GET /produtos/:id          | EO   | 2       | 7   | average    | 5      | `:id` + Produto 5 (delivered raw) + `podeEditar`; **nothing of Usuario**   |
| GET /produtos/resumo       | EO   | 1       | 2   | low        | 4      | `categorias.rotulo`, `categorias.total` — the literal the query object returns |
| GET /produtos/exportar     | EO   | 1       | 1   | low        | 4      | 1 opaque document, **reported**                                            |
| GET /produtos/:id/editar   | EO   | 2       | 6   | average    | 5      | `:id` + transformer `nome`, `preco`, `categoria` + mapped `fornecedores.id`, `.nome` |
| POST /produtos             | EI   | 1       | 4   | low        | 3      | the validator                                                              |
| **total**                  |      |         |     |            | **43** |                                                                            |

## The rules

1. **The delivery is the boundary.** The props argument of `inertia.render`,
   `inertia.modal`, `view.render`, and the payload of `response.json` / `.ok` /
   `.created` / `.send`. A transaction that delivers nothing (`redirect`,
   `noContent`) has no output DETs — an EI stays as it was.
2. Each key of the props literal, by what its value is:
   - a **transformer** the graph follows → its keys (as today);
   - a **followed call** (query object, module function, service) → what that
     body **returns**: the leaves of a returned literal (§7 rules, mapped
     literals once); with no literal, the stores the body reads, by the existing
     `whole` / `select` rules;
   - a variable **bound to a store** → that store's columns;
   - a **mapped literal** (`xs.map((x) => ({ a, b }))`) → its leaves, once;
   - a **nested literal** → its leaves;
   - anything else — a scalar, a property, an expression → **1 DET**;
   - a value that resolves to none of the above → 1, `(opaque)`, reported.
3. **A DET that enters and exits counts once** (AFP §7.3): a leaf whose name is
   already an input DET (`filtros.busca` after `request.input('busca')`) adds
   nothing.
4. **Props by identifier** resolve to the literal, or to the call, that
   initialised the identifier in the same body.
5. **A store touched but delivered by nothing** — read to authorise, to decide,
   to count — contributes no output DET. It stays an FTR: it was read.
6. `response.send(x)` where `x` is a followed call that returns no literal and
   reads no store (a CSV builder over a variable) is a **document**: 1 DET,
   opaque, reported — the fields of a generated file are not readable.
7. The identifier of a transformer's resource is still excluded (`id` on
   `ProdutoTransformer`); an `id` inside a mapped literal built in the controller
   is not — nothing says which store it is.

## What `afp@1.5.0` says, predicted

No function changes points. Every read changes what its DETs are made of, and
that is what the fixture asserts:

| function                 | 1.5.0 DET (from)                                | reference DET (from)                  |
| ------------------------ | ----------------------------------------------- | ------------------------------------- |
| GET /produtos            | 9 — inputs 2 + Produto 5 + Fornecedor 2         | 10 — the same + `total`               |
| GET /produtos/:id        | 8 — `:id` + Produto 5 + **Usuario 2**           | 7 — `:id` + Produto 5 + `podeEditar`  |
| GET /produtos/resumo     | **1** — `aggregate:Produto` only: the `select('categoria')` on the same chain is dropped, a 1.5.0 defect (a GROUP BY leaves the grouped column too) | 2 — the two leaves of the literal |
| GET /produtos/exportar   | 5 — Produto whole                               | 1 — a document, opaque                |
| GET /produtos/:id/editar | 6 — `:id` + transformer 3 + **Fornecedor 2 whole** | 6 — `:id` + transformer 3 + mapped 2 |

Predicted 1.5.0 total: **43 FP** (0) — and printed, once, before any code, to
check the fixture parses with full coverage: 43, with `resumo` at 1 DET where
this table first predicted 2. The prediction was wrong about the current rule
set, not about the reference: a `select` on an aggregate chain is thrown away
today, which is a defect this release fixes alongside the rule. That was the measurement's verdict on the
three validated applications too (−8, −2, +9): this rule decides what the number
is made of far more than what it is — and it is what makes `fp:explain`
defensible for an output: the DETs named are the ones the screen received.
