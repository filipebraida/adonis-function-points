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
| `GET /produtos/pagina`    | `const { data, meta } = await paginar.handle()` → `{ produtos: data, pagina: meta.pagina }`      |
| `GET /produtos/resumo`    | props by identifier → a query object that **returns a literal** with a `.map`                   |
| `GET /produtos/destaques` | an array assembled from the collection — a highlight first, the rest, cut to four            |
| `GET /produtos/exportar`  | `response.send(gerarCsv(produtos))` — a CSV built FROM the products handed in                  |
| `GET /produtos/manifesto` | `response.send(renderManifesto())` — a package function nobody can follow, nothing flowing in   |
| `GET /produtos/:id/editar`| `inertia.modal` with a transformer and a `.map((f) => ({ id, nome }))`                          |
| `GET /produtos/:id/relacionados` | destructured from a query object whose helpers are **local functions** — `lista.map(paraCard)` by reference, `paginator.getMeta()`, a map keyed by an enum; `filtros.categoria` echoed through `?.trim() ?? null` |
| `POST /produtos`          | validator with 4 fields, writes `Produto`                                                       |

## Reference: 62 unadjusted FP

| function                   | type | FTR/RET | DET | complexity | FP     | DET origin                                                                 |
| -------------------------- | ---- | ------- | --- | ---------- | ------ | -------------------------------------------------------------------------- |
| Produto                    | ILF  | 1       | 5   | low        | 7      | columns, minus `id`                                                        |
| Fornecedor                 | EIF  | 1       | 2   | low        | 5      |                                                                            |
| Usuario                    | EIF  | 1       | 2   | low        | 5      |                                                                            |
| GET /produtos              | EO   | 2       | 10  | average    | 5      | `busca`, `ativo` (in) + Produto 5 + Fornecedor 2 (what the query object reads) + `total` |
| GET /produtos/:id          | EO   | 2       | 7   | average    | 5      | `:id` + Produto 5 (delivered raw) + `podeEditar`; **nothing of Usuario**   |
| GET /produtos/pagina       | EO   | 2       | 9   | average    | 5      | `pagina` (in, `request.input`) + Produto 5 + Fornecedor 2 through `data` + `meta.pagina`; `porPagina` not delivered |
| GET /produtos/resumo       | EO   | 1       | 2   | low        | 4      | `categorias.rotulo`, `categorias.total` — the literal the query object returns |
| GET /produtos/destaques    | EO   | 2       | 8   | average    | 5      | Produto 5 + Fornecedor 2 (the collection, however assembled) + `total`      |
| GET /produtos/exportar     | EO   | 1       | 5   | low        | 4      | Produto 5 — the CSV carries the rows handed to the builder                  |
| GET /produtos/manifesto    | EO   | 1       | 1   | low        | 4      | 1 opaque document from a package call, **reported**; the count was read, not delivered |
| GET /produtos/:id/editar   | EO   | 2       | 6   | average    | 5      | `:id` + transformer `nome`, `preco`, `categoria` + mapped `fornecedores.id`, `.nome` |
| GET /produtos/:id/relacionados | EO | 2     | 10  | average    | 5      | `:id` + `categoria` (in) + `itens.nome`, `.preco`, `.fornecedor` (the local function's literal) + `meta.total`, `.perPage`, `.currentPage`, `.lastPage` + `porCategoria.*` (one repeating attribute); FTR Produto and Fornecedor, read inside the local function |
| POST /produtos             | EI   | 1       | 4   | low        | 3      | the validator                                                              |
| **total**                  |      |         |     |            | **62** |                                                                            |

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
   initialised the identifier in the same body. A name **destructured** from a
   call (`const { data, meta } = await q.handle()`) and a **property** of a
   call-bound variable (`resultado.linhas`) are one key of what that call
   returns — resolved against the body's return, classified, keeping only that
   key. Nothing else the body returned leaves.
4b. What a followed body returns is **classified**, not counted per key: in
   `{ data: rows, meta: { pagina } }`, `data` hands on the rows' store and
   `meta.pagina` one value. Counting one DET per key had turned a list into 1.
5. **A store touched but delivered by nothing** — read to authorise, to decide,
   to count — contributes no output DET. It stays an FTR: it was read.
6. A call that returns no literal and reads no store — a CSV builder, a
   formatter — delivers **what was handed into it**: the document carries the
   rows it received, so their stores leave (`gerarCsv(produtos)` → `Produto`).
   Only when nothing readable flows in is it a **document nobody can read**:
   1 DET, opaque, reported (`renderManifesto()` from a package, no arguments).
6b. An array assembled from a collection — spreads, `slice`, `filter`, `find`,
   `rows[0]` — is still that collection: its store leaves.
6c. A transformer **variant** (`X.transform(r).useVariant('forEgresso')`) is a
   method of the transformer named after it, and its keys leave with
   `toObject()`'s.
7. The identifier of a transformer's resource is still excluded (`id` on
   `ProdutoTransformer`); an `id` inside a mapped literal built in the controller
   is not — nothing says which store it is.
8. A **function of the same file** (`function proximos()`, `const f = () => …`
   at module level) is followed like an imported one: what it reads is an FTR,
   what it returns is delivered. `xs.map(paraCard)` — a function passed **by
   reference** — delivers what that function returns, once, like the inline
   `xs.map((x) => ({ … }))`.
9. `paginator.getMeta()` is Lucid's pagination: `total`, `perPage`, `currentPage`,
   `lastPage` — four values the page can show. The URLs are navigation and
   `firstPage` a constant; neither is a user-recognisable attribute. `meta.total`
   alone is one.
10. A literal whose keys are **computed** (`{ [STATUS.A]: n, [STATUS.B]: m }`) is a
    map: one repeating attribute (`porCategoria.*`), not one DET per key — the
    same reason a `.map()` counts its leaves once (§7).
11. An echo stays an echo through a **default** (`q ?? null`, `page || 1`) and
    through a **format call** on it (`startDate?.toISOString()`): the value is
    the input's, and it counted on entry. A call on a value bound to a store is
    one field (`produto.nome.toUpperCase()`); a call whose declared return type
    is a primitive (`bouncer.allows('create')` → `boolean`) is one value, named
    by its key — not opaque.

## What `afp@1.5.0` says, predicted

No function changes points. Every read changes what its DETs are made of, and
that is what the fixture asserts:

| function                 | 1.5.0 DET (from)                                | reference DET (from)                  |
| ------------------------ | ----------------------------------------------- | ------------------------------------- |
| GET /produtos            | 9 — inputs 2 + Produto 5 + Fornecedor 2         | 10 — the same + `total`               |
| GET /produtos/:id        | 8 — `:id` + Produto 5 + **Usuario 2**           | 7 — `:id` + Produto 5 + `podeEditar`  |
| GET /produtos/pagina     | 8 — `pagina` + Produto 5 + Fornecedor 2, whole | 9 — the same + `meta.pagina`         |
| GET /produtos/resumo     | **1** — `aggregate:Produto` only: the `select('categoria')` on the same chain is dropped, a 1.5.0 defect (a GROUP BY leaves the grouped column too) | 2 — the two leaves of the literal |
| GET /produtos/destaques  | 7 — Produto 5 + Fornecedor 2, whole            | 8 — the same 7 + `total`              |
| GET /produtos/exportar   | 5 — Produto whole                               | 5 — Produto, through the argument     |
| GET /produtos/manifesto  | 5 — Produto whole                               | 1 — a document, opaque                |
| GET /produtos/:id/editar | 6 — `:id` + transformer 3 + **Fornecedor 2 whole** | 6 — `:id` + transformer 3 + mapped 2 |

Predicted 1.5.0 total: **57 FP** (0) for the first twelve functions — and printed, once, before any code, to
check the fixture parses with full coverage: 43 for the first six transactions,
with `resumo` at 1 DET where this table first predicted 2. The prediction was wrong about the current rule
set, not about the reference: a `select` on an aggregate chain is thrown away
today, which is a defect this release fixes alongside the rule.

That "0" was the measurement's verdict on the three validated applications too
(−8, −2, +9 FP): this rule decides what the number is made of far more than what
it is — and it is what makes `fp:explain` defensible for an output: the DETs
named are the ones the screen received.

## What changed after the first recount, and why

The first version of this reference had `GET /produtos/exportar` at **1 DET,
opaque** — a generated CSV, unreadable. Recounting a real application showed a
questionnaire report at 2 DET with 6 FTR: the CSV builder received the report's
rows and columns as arguments, and the rule saw only that it returned a string.
A document is made of what was handed into it. Rule 6 was rewritten: the stores
flowing into an unresolved call leave, and only a call nothing flows into is
opaque. `exportar` moved from 1 to 5 DET (same 4 FP), and `manifesto` was added
as the case that stays opaque.

The same recount added `destaques` — a home page assembling `[destaque, ...rows]
.slice(0, 4)` had fallen to 1 DET — and rule 6c, after a page whose fields live
in a transformer **variant** came out at 5 DET with 5 FTR: `useVariant('x')`
names a method, and the resolver had followed only `toObject()`.

The second recount added `pagina` and rules 4/4b: a home page destructuring
`{ destaque, data }` from its query object had stayed at 1 DET, and a report
handing `relatorio.linhas` to a CSV builder at 2 — the classifier saw neither
the destructuring nor the property as one key of what the call returned, and
what a followed body returned was being counted one DET per key. It also
corrected the variant rule: `useVariant('x')` **replaces** `toObject()`, so only
the variant's keys leave — following both had doubled a list page to 65 DET.

The third recount added `relacionados` and rules 8–11: a news page whose related
items came from a **local function** of the query file had those items counted as
two whole tables (the call was unresolved, so the rows handed into it left); a home
page mapping rows through `noticias.map(paraLinhaPublica)` — by reference — had
fallen to 1 DET; every listing page echoing its filters through `q ?? null` or
`startDate?.toISOString()` counted them twice; a pagination helper returning
`paginator.getMeta()` fields came out half scalar, half opaque; and a status map
keyed by an enum counted 11 DETs for one repeating attribute. `relacionados` is
predicted at **10 DET, 5 FP** — and at 1.5.0 it would have been unresolved:
`proximos()` followed by nothing, `Produto` and `Fornecedor` reached by nobody
from this route, and the output 1 opaque DET.
