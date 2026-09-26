# fronteira_pacote — reference count

Fixture for plan 0.11 §A: **a call into a package is outside the boundary**. Three families
kept coming back on the validated applications as unresolved calls — an authorisation
service from a package injected into the application's façade, a variant of an attachment
whose column type comes from a package, a content collection built by a package's factory —
and none of them is code the analysis should follow: what a package does with its own tables
is technical (§4), what it hands back is a value. The error was one of category: "unresolved
call" is "code that may read or write data and the walk could not follow", and nobody follows
a package. Written before the code.

## The application

| store     | columns (besides `id`)                                 | role                                                 |
| --------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `Pedido`  | `descricao`, `status`, `capa: Anexo \| null` (package type) | written by the POST: ILF, 2 DET — the attachment column is a value the package manages |
| `Usuario` | `nome`                                                 | read to authorise: EIF                               |

Three transactions and four call sites the walk cannot follow:

| site                                                    | what it is                                                                   | verdict            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------ |
| `this.permissoes.pode` in `services/permissoes.ts`      | `permissoes` is injected as `PermissaoService`, a class of `@acme/permissoes` | **note** — outside |
| `this.resource.capa?.variante('thumb')` in the transformer | `capa` is a column typed `Anexo` from `@acme/anexos/types`                 | **note** — outside |
| `guias.carregar` in the controller                      | `guias` is `definirColecao(…)` from `@acme/conteudo`: a package's collection over a JSON file | **note** — outside |
| `this.gerador.gerar` in `services/relatorios.ts`        | `gerador` is typed by an **interface of the application** with no implementation found | **unresolved** — a gap, and it stays one |

## Reference: 23 unadjusted FP

| function            | type | FTR/RET | DET | complexity | FP     | DET origin                                                                      |
| ------------------- | ---- | ------- | --- | ---------- | ------ | ------------------------------------------------------------------------------- |
| Pedido              | ILF  | 1       | 2   | low        | 7      | `descricao`, `status` — the attachment column is a package's value, not a DET   |
| Usuario             | EIF  | 1       | 1   | low        | 5      |                                                                                 |
| GET /pedidos        | EO   | 2       | 5   | low        | 4      | transformer `descricao`, `status`, `capaThumb` + `podeEditar` + `ajuda` (opaque: a package's value, reported as an unreadable delivery as before) |
| GET /pedidos/resumo | EO   | 1       | 2   | low        | 4      | Pedido whole                                                                    |
| POST /pedidos       | EI   | 1       | 1   | low        | 3      | `descricao`                                                                     |
| **total**           |      |         |     |            | **23** |                                                                                 |

**Unchanged from 0.10.1** — no point moves. What changes is the coverage line and the lists:

- `unresolved`: **1** — `this.gerador.gerar`, "call that no strategy knew how to follow";
- `notes`: **3**, one per site, in these words:
  - `GET /pedidos: call into @acme/permissoes (this.permissoes.pode) — outside the boundary; what a package does with its own tables is technical (§4), what it hands back is a value`
  - `GET /pedidos: call into @acme/anexos/types (this.resource.capa?.variante) — outside the boundary; …`
  - `GET /pedidos: call into @acme/conteudo (guias.carregar) — outside the boundary; …`

## Nothing falls out in silence (plan 0.12 §A)

Three more routes, none counted, each said in the report:

| route                 | what it is                                                        | report                                                                            |
| --------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /sobre`          | a static page, no store                                           | listed under "reach no data store … not counted (§1)"                             |
| `GET /painel/contagem`| `db.from('pedidos').count(…)` — the raw query builder             | the same list, **marked ⚑**: a data access the analysis does not read yet          |
| `GET /ajuda`          | `router.on('/ajuda').redirect(…)`, no handler                     | the coverage line names it: `1 entry point without a handler: GET /ajuda`         |

Under §B `GET /painel/contagem` becomes an EO and leaves the list; `GET /sobre` stays on it, which is right.

## The rules

1. A call is **into a package** when, structurally, its receiver or its target resolves to a
   specifier the application does not: an injected property (or class property) whose declared
   type is imported from such a specifier; a column of a store whose declared type is; a local
   or an exported const built by a factory imported from one; a member of an application class
   that has no body because it comes from a package base. No package is named in the library:
   the same reading the 0.10.1 gave bases and mixins.
2. It is **noted, not unresolved**: `inventory.notes`, printed by `fp:inventory`, one line per
   site with the transactions reaching it. It does not lower coverage — coverage measures what
   of the APPLICATION the walk could not follow.
3. What such a call hands back is a value and is read as one already (a delivered value nobody
   can read is 1 DET, opaque, reported — `ajuda` above); what the package does with its own
   tables is technical (§4).
4. A receiver typed by the application (`GeradorDeRelatorios`, an interface with no
   implementation found) is **not** a package: it stays an unresolved call.

## What 0.10.1 says — printed before the code

The same 23 FP, with **4 unresolved calls** — the three package sites and the control — and
no notes. The rule moves the three into notes and leaves the control where it is.
