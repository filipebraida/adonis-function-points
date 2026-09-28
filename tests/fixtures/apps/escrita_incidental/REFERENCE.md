# escrita_incidental — reference count

Fixture for plan 0.14 §C: **primary intent, declared about the call**. The CPM classifies a
transaction by what it is primarily for. A page that counts its own visit, or creates a default
catalogue the first time anybody reads it, writes — and is still a page. A callback that links an
external account is a `GET` too, and writing is its point. The three are indistinguishable in the
code (`save()` on a counter, `createMany` after a check, `updateOrCreate`), so the library asks and
the team answers. Written before the code.

## Without a declaration — what `afp@1.11.0` prints: 33 FP

| function            | type | FTR | DET | FP | |
| ------------------- | ---- | --- | --- | -- | - |
| Categoria           | ILF  | 1   | 1   | 7  | written by the default catalogue |
| Conta               | ILF  | 1   | 2   | 7  | |
| Pedido              | ILF  | 1   | 3   | 7  | `visualizacoes` is written by the counter |
| GET /pedidos/:param | EI   | 1   | 1   | 3  | the visit counter makes it an EI |
| GET /catalogo       | EI   | 1   | 1   | 3  | the default catalogue makes it an EI |
| GET /conta/callback | EI   | 1   | 1   | 3  | right |
| POST /pedidos       | EI   | 1   | 1   | 3  | |
| **total**           |      |     |     | **33** | |

New in 0.14, no point moves: a warning lists the three `GET` routes counted as EI, with the store and
the body that writes, and says how to answer:

```
3 GET route(s) counted as EI because they write — the CPM classifies by primary intent; a write that
only supports the page (a visit counted, a default created on first read) can be declared with
incidentalWrites():
  GET /catalogo — writes Categoria (app/actions/garantir_catalogo.ts#garantirCatalogo)
  GET /conta/callback — writes Conta (app/controllers/pedidos_controller.ts#callback)
  GET /pedidos/:param — writes Pedido (app/actions/registrar_visita.ts#registrarVisita)
```

## `incidentalWrites({ name: 'visits and defaults', methods: ['registrarVisita', 'garantirCatalogo'] })` — 35 FP

| function            | type | FTR | DET | FP | |
| ------------------- | ---- | --- | --- | -- | - |
| Categoria, Conta, Pedido | ILF | | | 21 | **unchanged**: still maintained by this application |
| GET /pedidos/:param | **EO** | 1 | 3 | **4** | `:id`, `descricao`, `status` — what it shows |
| GET /catalogo       | **EO** | 1 | 1 | **4** | `select:Categoria.nome` |
| GET /conta/callback | EI   | 1   | 1   | 3  | not declared: stays an EI |
| POST /pedidos       | EI   | 1   | 1   | 3  | |
| **total**           |      |     |     | **35** | |

The warning lists only `GET /conta/callback`, and a second line says what the declaration did:
`2 transaction(s) write only incidentally (declared) and are classified by what they show: GET /catalogo, GET /pedidos/:param`.

## The rules

1. A transaction triggered by `GET` or `HEAD` and classified EI is listed, with the stores it
   writes and the bodies that write them. The list asks; it never reclassifies.
2. `incidentalWrites({ name, methods?, matching? })` — the sibling of `ignoreCalls`, the same
   `methods` / `matching` over the callee — declares that the writes reached through those calls do
   not decide what the transaction is. It is the `technicalWrite` of counting-decisions §9, which
   until now only a hand-written resolver could use. The store is still written: still an ILF,
   still an FTR.
3. A declaration that reclassifies nothing is reported as having no effect.
