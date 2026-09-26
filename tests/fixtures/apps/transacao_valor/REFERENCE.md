# transacao_valor — reference count

Fixture for plan 0.10 §B: **the value of `await db.transaction(async (trx) => { … })` is
what the callback returns**. A reviewing team's application picks a row out of such a
value and writes it afterwards — `const { verification } = await db.transaction(…)`, then
`verification.save()` — and the write was an unreadable receiver. On the three validated
applications the value of a transaction callback is used 17 times. Written before the code.

## The application

| store         | columns (besides `id`)      | role                                                                                |
| ------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| `Verificacao` | `pessoaId`, `link`, `status` | created inside the callback, written outside it through the returned value: ILF     |
| `Pessoa`      | `cpf`                       | read before the transaction, never written: EIF                                     |

Three transactions:

| route                          | the callback returns                                            | what happens to the value                                   |
| ------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------- |
| `POST /verificacoes`           | `{ verificacao: viva, reutilizada }` or `{ verificacao: criada, … }` — the same store under the same key, from two returns | `verificacao.save()` outside the callback |
| `POST /verificacoes/:id/anular`| `linhas.length` — a number                                      | echoed in the response; the writes happened INSIDE the callback, which the graph already walks |
| `POST /verificacoes/:id/carimbar` | `row` from `trx.rawQuery(…)` — nobody can type it             | `alvo.save()`: **reported** as a write on a receiver whose type the analysis cannot read |

## Reference: 25 unadjusted FP

| function                        | type | FTR/RET | DET | complexity | FP     | DET origin                                                                        |
| ------------------------------- | ---- | ------- | --- | ---------- | ------ | --------------------------------------------------------------------------------- |
| Verificacao                     | ILF  | 1       | 3   | low        | 7      |                                                                                   |
| Pessoa                          | EIF  | 1       | 1   | low        | 5      |                                                                                   |
| POST /verificacoes              | EI   | 2       | 1   | low        | 3      | `cpf`; FTR Pessoa + Verificacao — **0 unresolved calls**                            |
| POST /verificacoes/:id/anular   | EI   | 1       | 1   | low        | 3      | `:id`; the writes inside the callback; the number returned binds nothing            |
| POST /verificacoes/:id/carimbar | EO   | 1       | 1   | low        | 4      | `:id`; reads Verificacao? no — reads nothing the graph sees: **not counted** … see below |
| **total**                       |      |         |     |            |        |                                                                                   |

`carimbar` reaches no store the graph can see (`trx.rawQuery` is raw SQL), so under
AFP §6.5.3 it is **not a transaction** — and its `alvo.save()` is still listed as an
unresolved call, so the gap is visible. Total: 7 + 5 + 3 + 3 = **18 FP**, `unresolvedCalls`
= **1**.

**Since afp@1.10.0 (plan 0.12 §B)** the raw query itself is read: `select * from carimbos`
names a table no model declares, so it becomes a **second** unresolved call — "raw query on
a table no model declares: carimbos". Still 18 FP: `carimbar` still reaches no store the
count knows. Two gaps now, each at its own line.

## The rules

1. `await db.transaction(async (trx) => { … })`, `Model.transaction(…)` and
   `trx.transaction(…)` (a savepoint) are a **body** whose value is what it **returns**: the
   same reading as a followed method's returns (0.8 §A). An identifier bound to it is the
   store every `return` names; a name **destructured** from it (`const { verificacao } = …`)
   is the store every returned literal names under that key. Two stores under one key, or a
   key some return omits, bind nothing — and a write on the value stays reported.
2. The callback's own locals (`viva`, `criada`) are bound **first**, in source order, so a
   `return { verificacao: criada }` can be read — the callback is a descendant of the body
   and its statements are the body's.
3. A returned number, string or boolean binds nothing and is not reported: the value is not
   rows. A returned raw-query row is unreadable, and a write on it is reported as before.
4. Nothing changes inside the callback: the graph already walks it as part of the body, so
   the writes there were already counted (`anular` was already an EI).

## What `afp@1.8.0` says — printed before the code

`POST /verificacoes`: EI, 2 FTR — the `create` inside the callback already writes
`Verificacao` — with **1 unresolved call**, `verificacao.save`. `anular`: EI 1 FTR. `carimbar`:
not counted — and its `alvo.save` was **not** reported, where this table first predicted it
would be: the 0.8 rule "a value a package built is not a store" excluded it, because `db`
is a package import. Too wide — `db.transaction(cb)` hands back what the callback returns.
The rule narrows to a call with **no function argument**, so `alvo.save` is reported after
the code. **18 FP, 1 unresolved** before; **18 FP, 1 unresolved** after — a different one:
`verificacao.save` bound and gone, `alvo.save` visible at last. The rule moves no point on
this fixture, as on the reviewing team's application; the gain is where the `create` is not
in the same body, and in a report that now names the right gap.
