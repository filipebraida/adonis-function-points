# mestre_detalhe — reference count

Fixture for the data-function grouping rule: a detail the user only ever sees
inside its master is a **RET** of the master's ILF, not an ILF of its own.
Written before the code, with what the current rule set produces predicted
beside it.

## The application

An order with its lines, comments and tags:

| store        | columns (besides `id`)                                   | relations                                   | addressed directly by application code? |
| ------------ | -------------------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `Pedido`     | `cliente`, `status`, `total`, `observacao`, `emitidoEm`, `createdAt` (system) | hasMany itens, comentarios, etiquetas | yes — `Pedido.query()`, `Pedido.create()` |
| `ItemPedido` | `pedidoId`, `produto`, `quantidade`, `preco`             | belongsTo pedido                            | **no** — only `pedido.related('itens')` / `preload('itens')` |
| `Comentario` | `pedidoId`, `autor`, `texto`                             | belongsTo pedido; hasMany etiquetas         | yes — `Comentario.query()` in `GET /comentarios` |
| `Etiqueta`   | `nome`, `pedidoId`, `comentarioId`                       | belongsTo pedido, belongsTo comentario      | **no** — only `preload('etiquetas')`  |

Six transactions:

| route                          | reaches                                              | writes            |
| ------------------------------ | ---------------------------------------------------- | ----------------- |
| `GET /pedidos`                 | Pedido, itens (preload)                              |                   |
| `GET /pedidos/:id`             | Pedido, itens, comentarios, etiquetas (preload)      |                   |
| `POST /pedidos`                | Pedido                                               | Pedido            |
| `POST /pedidos/:id/itens`      | Pedido, `pedido.related('itens').create(...)`        | ItemPedido        |
| `POST /pedidos/:id/comentarios`| Pedido, `pedido.related('comentarios').create(...)`  | Comentario        |
| `GET /comentarios`             | Comentario                                           |                   |

## The rule

A store `C` is a RET of `P` when, and only when, all three hold:

1. `P` declares `hasMany` / `hasOne` → `C` — a composition relation;
2. **no application code addresses `C` directly** — no `C.query()`, `C.find…()`,
   `C.create()`, `new C()` anywhere outside tests, seeders and factories. The user
   only ever reaches it through `P`, so under the CPM the user does not recognise
   it as a logical file of its own;
3. exactly one `P` satisfies (1). With two or more, `C` stays its own data
   function and the count says why.

It is the rule the count already uses for everything else: the graph decides
(§6.5.4 decides ILF/EIF and what is counted by use; this decides RET by use).
Cascade delete was measured and rejected — on a real application 11 of 13
cascades pointed at the tenant table.

Consequences, all needed for the number to close:

- DET of the group = the non-identifier, non-system columns of every member,
  **minus each child's foreign key to its parent** — inside one logical file
  that key is the subgroup's link, not an attribute the user recognises. A
  foreign key to a *different* data function still counts (`Comentario.pedidoId`).
- A transaction touching a child touches the group: **one** FTR.
- A write to a child maintains the group: ILF.
- RET = 1 + the children grouped in.

## Reference: 41 unadjusted FP

| function                        | type | RET/FTR | DET | complexity | FP     | how                                                          |
| ------------------------------- | ---- | ------- | --- | ---------- | ------ | ------------------------------------------------------------ |
| Pedido                          | ILF  | 2       | 8   | low        | 7      | 5 own + 3 of `ItemPedido` (`pedidoId` is the link)           |
| Comentario                      | ILF  | 1       | 3   | low        | 7      | addressed by `GET /comentarios`: its own file                |
| Etiqueta                        | EIF  | 1       | 3   | low        | 5      | two composition parents: kept apart, **reported**            |
| GET /pedidos                    | EO   | 1       | 8   | low        | 4      | the group is one FTR; its 8 columns                           |
| GET /pedidos/:id                | EO   | 3       | 15  | average    | 5      | `:id` + 8 + 3 + 3; group, Comentario, Etiqueta               |
| POST /pedidos                   | EI   | 1       | 3   | low        | 3      | `cliente`, `observacao`, `emitidoEm`                          |
| POST /pedidos/:id/itens         | EI   | 1       | 4   | low        | 3      | `:id` + 3 fields; the item write maintains the group          |
| POST /pedidos/:id/comentarios   | EI   | 2       | 3   | low        | 3      | `:id` + 2 fields; group + Comentario                          |
| GET /comentarios                | EO   | 1       | 3   | low        | 4      |                                                              |
| **total**                       |      |         |     |            | **41** |                                                              |

`ItemPedido` does not appear: it is the second RET of `Pedido`. `fp:explain
Pedido` has to list it as such, with the reason.

## What the current rule set says, predicted

Every model is its own data function, and a transaction reaching parent and
child pays two FTRs:

| function                 | current                         | reference     |
| ------------------------ | ------------------------------- | ------------- |
| Pedido                   | ILF RET 1, DET 5, 7 FP          | RET 2, DET 8, 7 FP |
| ItemPedido               | **ILF, 7 FP**                   | — (a RET)     |
| GET /pedidos             | FTR 2, DET 9, **5 FP**          | FTR 1, DET 8, 4 FP |
| GET /pedidos/:id         | FTR 4, DET 16, **7 FP**         | FTR 3, DET 15, 5 FP |
| POST /pedidos/:id/itens  | FTR 2, 3 FP                     | FTR 1, 3 FP   |

Predicted current total: **51 FP** (+10 over the reference). One invented ILF
and two transactions pushed up a band by an FTR that is the same logical file
seen twice.

## Transcription choices

- `Comentario` has `GET /comentarios` **on purpose**: it is the control that
  stops the rule from being "every `hasMany` child is a RET" — which would have
  merged `Apontamento` into `Pessoa` in the Vazquez benchmark, against the
  published count.
- `Etiqueta` hangs off two parents on purpose, and is never written, so it also
  exercises "used but not maintained → EIF" on a store the grouping declined.
- `createdAt` on `Pedido` is `autoCreate` and does not count, per the
  `system_timestamps` fixture; it is here so the grouping and the timestamp
  rules are seen composing.
