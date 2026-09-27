# fronteira_tabela — reference count

Fixture for plan 0.13 §B: **a table no model declares, named in the boundary, is a data
function**. The application reads and writes `registros` through the raw query builder and has
no model for it — a package's migration created it — but the generated schema
(`database/schema.ts`) has its structure: `RegistroSchema`, six columns. Whether that table is
the user's data, another system's, or technical is a business decision no heuristic makes; the
configuration says it, and the code is never touched to say it. Written before the code.

## The application

| store / table | columns (besides `id`)                                  | known by                                |
| ------------- | ------------------------------------------------------- | --------------------------------------- |
| `Pedido`      | `descricao`, `status` (`createdAt` is a system stamp)   | a model, `extends PedidoSchema`         |
| `registros`   | `pedidoId`, `acao`, `autor`, `detalhe` (two stamps)     | **only** the generated `RegistroSchema` |

| route                    | what it does                                                                 |
| ------------------------ | ---------------------------------------------------------------------------- |
| `GET /pedidos`           | `Pedido.query().select('descricao', 'status')`                                |
| `POST /pedidos`          | `Pedido.create({ descricao })`                                                |
| `GET /painel/registros`  | `db.from('registros').select('acao', 'autor', 'detalhe')`                     |
| `GET /painel/resumo`     | `db.from('pedidos').join('registros', …).select('pedidos.status', 'registros.acao')` |
| `POST /painel/registros` | `db.table('registros').insert({ pedido_id, acao, autor })` from the request   |

## Without a declaration — what `afp@1.10.0` says, printed before the code: 18 FP

| function        | type | FTR | DET | FP | DET origin                  |
| --------------- | ---- | --- | --- | -- | --------------------------- |
| Pedido          | ILF  | 1   | 2   | 7  | `descricao`, `status`       |
| GET /pedidos    | EO   | 1   | 2   | 4  | the select                  |
| POST /pedidos   | EI   | 1   | 1   | 3  | `descricao`                 |
| GET /painel/resumo | EO | 1  | 1   | 4  | `pedidos.status`; `registros.acao` belongs to no store the count knows |
| **total**       |      |     |     | **18** |                         |

**3 unresolved calls**, one per site, each naming the three `boundary` keys; `GET /painel/registros`
and `POST /painel/registros` listed as routes that reach no store (§1). Unchanged by §B: with no
declaration the table is still not a data function the count knows.

## `boundary.business: ['registros']` — 32 FP

The table becomes the store `Registro` (the class name without `Schema`), its columns read off the
generated class — `generated-schema:` is where they truly come from. The application writes it
(`POST /painel/registros`): an **ILF**.

| function               | type | FTR | DET | FP | DET origin                                   |
| ---------------------- | ---- | --- | --- | -- | -------------------------------------------- |
| Pedido                 | ILF  | 1   | 2   | 7  |                                              |
| **Registro**           | ILF  | 1   | 4   | 7  | `pedidoId`, `acao`, `autor`, `detalhe` — the FK to another data function counts |
| GET /pedidos           | EO   | 1   | 2   | 4  |                                              |
| POST /pedidos          | EI   | 1   | 1   | 3  |                                              |
| **GET /painel/registros** | EO | 1  | 3   | 4  | `select:Registro.acao/autor/detalhe`         |
| GET /painel/resumo     | EO   | **2** | **2** | 4 | `select:Pedido.status`, `select:Registro.acao` |
| **POST /painel/registros** | EI | 1  | 2   | 3  | `request:pedidoId`, `request:acao`           |
| **total**              |      |     |     | **32** |                                          |

**0 unresolved calls.** A warning says the table was counted by declaration, with its source:
`1 table(s) no model declares, counted by declaration in boundary.business: Registro (registros,
4 DET from the generated schema)`.

## `boundary.externallyMaintained: ['registros']` — 30 FP

The same store, an **EIF** at 5 because the declaration says another system maintains it. But the
code contradicts the declaration — `POST /painel/registros` writes it — and the report says so:
`declared in boundary.externallyMaintained, but this application writes it: POST /painel/registros`.
The declaration is honoured (only a person knows) and the contradiction is in the report.
Registro EIF 5 instead of ILF 7: **30 FP**, 0 unresolved.

## `boundary.infrastructure: ['registros']` — 18 FP

Technical by declaration: the store exists, so its sites are no longer gaps, and it is excluded
like any infrastructure store. `GET /painel/registros` and `POST /painel/registros` reach nothing
that counts and are listed under §1; `GET /painel/resumo` counts through `Pedido` alone, FTR 1,
DET 1. **18 FP, 0 unresolved.** The contradiction the code shows is reported:
`declared in boundary.infrastructure, but it is shown to the user by: GET /painel/registros,
GET /painel/resumo` — a technical table does not leave on a screen.

## No structure known

A table declared in any of the three keys for which the generated schema has no class stays
exactly where it was — not counted, its sites unresolved — and one warning says why:
`declared in boundary.business: 'arquivados' — no model and no generated-schema class describes
it, so the count cannot know its columns`. Asserted in the spec with a declaration of a table the
fixture does not have.

## The rules

1. A table named in `boundary.business`, `boundary.externallyMaintained` or
   `boundary.infrastructure` that no model reads becomes a store when the generated schema has a
   class for it; the class matches when its name, snake-cased with or without the plural, is the
   table. Name: the class name without `Schema`. Columns and system stamps: read as for any store.
2. From there nothing is special: the raw accesses of 0.12 resolve the table; `business` →
   ILF or EIF by §6.5.4; `externallyMaintained` → EIF; `infrastructure` → excluded.
3. Every such table is listed as counted by declaration, and a declaration the code contradicts
   (an external table the application writes, an infrastructure table a transaction shows) is
   reported; neither changes the number the declaration asked for.
4. A name that matches a model's store or table keeps today's meaning; nothing here touches models.
