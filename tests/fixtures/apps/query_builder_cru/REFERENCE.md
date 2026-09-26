# query_builder_cru — reference count

Fixture for plan 0.12 §B: **the raw query builder is a data access**. A reviewed
application's whole management area is written against `db.from('t')`, never
`Model.query()`; the detector knew models only, so those pages reached no store and fell
out of the count in silence for three releases. The table named in `from` IS the store —
the mapping (`static table`, or the name derived from the class) has always existed.
Written before the code.

## The application

| store     | columns (besides `id`)                                  | role                                                              |
| --------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `Pedido`  | `descricao`, `status`, `valor`, `responsavelId`, `prazo` | written by `update` and `insert` through the builder: **ILF**     |
| `Usuario` | `nome`, `email`, `cargo`                                | read through the builder and a join: EIF                          |
| pivot `pedido_usuario` | —                                          | declared by `@manyToMany(…, { pivotTable })`: the relation, not a store |
| table `configuracoes` | —                                           | no model declares it: not a store the count knows                 |

Eight routes, one builder shape each:

| route                         | shape                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /painel`                 | `db.from('pedidos').where(…).count('* as total')` — an aggregate                               |
| `GET /painel/equipe`          | `db.from('usuarios').select('nome', 'email')` — named columns                                  |
| `GET /painel/carga`           | `db.from('pedidos').join('usuarios', …).select('usuarios.nome', db.raw('count(*) as total'))` — a join |
| `POST /painel/:id/reatribuir` | `db.from('pedidos').where(…).update({ … })` — a write                                          |
| `POST /painel/lote`           | `trx.table('pedidos').insert({ … })` inside `db.transaction` — a write through the client       |
| `GET /painel/pares`           | `db.from('pedido_usuario').count(…)` — the pivot                                                |
| `GET /painel/config`          | `db.from('configuracoes').first()` — a table no model declares                                  |
| `GET /painel/arquivo`         | `db.from(tabela).count(…)` — a table named by an expression                                      |
| `GET /painel/sql`             | `db.rawQuery('select status, count(*) as total from pedidos group by status')` — literal SQL    |

## Reference: 38 unadjusted FP

| function                    | type | FTR/RET | DET | complexity | FP     | DET origin                                                                  |
| --------------------------- | ---- | ------- | --- | ---------- | ------ | --------------------------------------------------------------------------- |
| Pedido                      | ILF  | 1       | 5   | low        | 7      | columns, minus `id`                                                         |
| Usuario                     | EIF  | 1       | 3   | low        | 5      |                                                                             |
| GET /painel                 | EO   | 1       | 1   | low        | 4      | `aggregate:Pedido`                                                          |
| GET /painel/equipe          | EO   | 1       | 2   | low        | 4      | `select:Usuario.nome`, `select:Usuario.email`                               |
| GET /painel/carga           | EO   | 2       | 2   | low        | 4      | `select:Usuario.nome` + `count(*) as total`, one derived value; Pedido joined |
| POST /painel/:id/reatribuir | EI   | 1       | 2   | low        | 3      | `:id`, `responsavelId`                                                      |
| POST /painel/lote           | EI   | 1       | 1   | low        | 3      | `descricao`                                                                 |
| GET /painel/pares           | EO   | 2       | 1   | low        | 4      | `aggregate` over the pivot: both stores are FTRs                            |
| GET /painel/sql             | EO   | 1       | 2   | low        | 4      | `select:Pedido.status` + `count(*) as total` from the SQL literal           |
| **total**                   |      |         |     |            | **38** |                                                                             |

`GET /painel/config` is **not counted** — `configuracoes` is no store the count knows —
and is **1 unresolved call**: "raw query on a table no model declares: configuracoes".
`GET /painel/arquivo` is **not counted** either and is the **second** unresolved call: "raw
query over an expression the analysis cannot read (tabela): a subquery or a computed table
name". Nothing else is unresolved; the ⚑ list of §A is empty for this application — every builder chain
was either read or said.

## The rules

1. A chain rooted at `db` (`@adonisjs/lucid/services/db`), a transaction client (`trx`) or
   `Database` is an access to the store whose **table** is the literal of the first
   `from('t')` / `table('t')` / `insertQuery().table('t')` / `into('t')`. `.join('u', …)`
   adds the joined table's store.
2. `.select('a', 'b')` names the columns (the `select:` rule of §6); a qualified name
   (`usuarios.nome`) belongs to that table's store; an expression (`db.raw('count(*) as
   total')`, `'count(*) as total'`) is one derived value; `.count/.sum/.avg/.min/.max` is
   an aggregate — 1 DET, whatever else is known (§6); no select → every column.
3. `.update(…)`, `.insert(…)`, `.delete()`, `.increment(…)`, `.decrement(…)` are writes:
   the transaction is an EI.
4. A **pivot** — the `pivotTable` of a declared `@manyToMany`, or a name that joins two
   store tables — is the relation: reading it reads both stores, writing it maintains the
   relation (as `attach`/`detach` already do).
5. A table **no model declares** is not a store the count knows: the access is an
   unresolved call, "raw query on a table no model declares: <t>". Never silence.
6. `db.rawQuery(sql)` with a **literal** string — or a template, or a `const` holding one:
   the statement's table is read off `update <t>` / `insert into <t>` / `delete from <t>`,
   or is the first table after a `from`; every other table after `from` or `join` is read
   on the way; names a `with` defines are not tables. The select list, when it is one,
   names the columns. A template with an expression where the table goes is an unresolved
   call; a statement that names no table (`select pg_advisory_xact_lock(?)`) is no access.
   `db.raw(…)` **inside** `.select(…)` is an expression of the `from` that contains it,
   not an access of its own.
7. Aliases resolve: `from('pedidos as p')`, `join('usuarios as u', …)`, `select('u.nome')`.
   A builder kept in a local (`const q = db.from('t')`) is read where it runs, not where it
   is built.
8. A table named by an expression (`db.from(tabela)`, a subquery) is an unresolved call:
   "raw query over an expression the analysis cannot read (…)".
9. `ignoreCalls` in the configuration covers a raw query like any other call: a table the
   team knows is a package's is declared data-free once.

## What `afp@1.9.0` says — printed before the code

**0 FP.** No transaction touches a store, so no store is reached by anybody and both
models drop out under §6.5.4; the eight routes are listed by §A as "reach no data store …
not counted", every one marked ⚑ raw query builder (nine, with `arquivo`). That is the reviewed application's
management area, in miniature.
