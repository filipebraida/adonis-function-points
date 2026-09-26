# escritas_indiretas — reference count

Fixture for plan 0.8 §A/§B: **a write binds to what the variable is, not to where
it was born**. The reviewed application's dominant shape is "the controller loads
the record, the action alters it" — and every one of those writes was invisible,
with coverage at 99.5%. Written before the code; what `afp@1.6.0` prints is at
the end, and it is the team's report reproduced.

## The application

| store         | columns (besides `id`)                                   | role                                                                        |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Documento`   | `nome`, `conteudo`, `arquivado`, `pastaId`, `responsavelId` | written by every action, always through an instance loaded elsewhere: **ILF** |
| `Pasta`       | `nome`                                                   | read to reach its documents; written through `documento.pasta`: **ILF**     |
| `Sessao`      | `documentoId`, `encerradaEm`                             | written through what a service RETURNS: **ILF**                             |
| `Usuario`     | `nome`                                                   | read to assign; written as `auth.getUserOrFail()` — the guard's user (`config/auth.ts`): **ILF** |
| `Historico`   | `documentoId`, `usuarioId`, `quando`                     | written only by a service the CONTAINER resolves: **ILF**                   |
| `Notificacao` | `documentoId`, `mensagem`                                | written only by a service in a local (`new Notificador()`): ILF — already seen today |
| `Assinatura`  | `documentoId`, `assinadoEm`                              | written row by row after a query a METHOD OF THE MODEL returns: **ILF**   |

Seven transactions, one shape each:

| route                           | where the written instance comes from                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `PATCH /documentos/:id`         | `handle({ documento, nome }: RenomearInput)` — destructured, **named** interface, same file    |
| `DELETE /documentos/:id`        | `handle(input: ExcluirInput)` then `const { documento } = input` — interface **imported**      |
| `POST /documentos/:id/arquivar` | `const sessao = await this.sessoes.ativa(documento)` — a followed method, `Promise<Sessao \| null>` |
| `POST /pastas/:id/limpar`       | `for (const documento of pasta.documentos)` — a row of a preloaded relation                    |
| `POST /documentos/:id/atribuir` | `const svc = await app.container.make(AtribuicaoService); svc.atribuir(documento, usuario)`    |
| `POST /documentos/:id/notificar`| `const svc = new Notificador(); svc.enviar(documento)` — the control: already followed today   |
| `POST /documentos/:id/carimbar` | `alvo.save()` where `alvo` comes from a helper returning a `Map#get` — **nobody can type it**    |
| `GET /documentos/:id/exportar`  | `pdf.save()` on pdf-lib's `PDFDocument` — a package's object, **not a store, not reported**    |
| `POST /documentos/:id/assinar`  | `await documento.pendentes().forUpdate()` — a method the model declares, a query chain, a `for…of` |

Six more, found by the first recount — the writes the new rule REPORTED as unreadable
on the three applications, one shape each:

| route                           | where the written instance comes from                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /documentos`              | `id ? await Documento.find(id) : new Documento()` — a conditional, both branches the same store |
| `POST /documentos/:id/sessao`   | `(await Sessao.query()….first()) ?? new Sessao()` — a `??` over a query and a constructor        |
| `POST /pastas/:id/marcar`       | `pasta.documentos.map(async (documento) => …)` — the callback's parameter over a relation      |
| `POST /perfil`                  | `auth.getUserOrFail()` — the guard's user, named by `config/auth.ts` (`model: () => import(…)`) |
| `POST /documentos/:id/pasta`    | `const pasta = documento.pasta` — a `belongsTo` read off a loaded row                          |
| `POST /documentos/:id/duplicar` | `const copia = await this.copia(original)` — a helper with NO annotation whose every `return` is `Documento.create(…)` |

## Reference: 97 unadjusted FP

| function                         | type | FTR/RET | DET | complexity | FP     | DET origin                                                    |
| -------------------------------- | ---- | ------- | --- | ---------- | ------ | ------------------------------------------------------------- |
| Documento                        | ILF  | 1       | 5   | low        | 7      | columns, minus `id`                                           |
| Pasta                            | ILF  | 1       | 1   | low        | 7      | written through `documento.pasta`                             |
| Sessao                           | ILF  | 1       | 2   | low        | 7      |                                                               |
| Usuario                          | ILF  | 1       | 1   | low        | 7      | written as the authenticated user                             |
| Historico                        | ILF  | 1       | 3   | low        | 7      | reached at last: the container's service writes it            |
| Notificacao                      | ILF  | 1       | 2   | low        | 7      |                                                               |
| Assinatura                       | ILF  | 1       | 2   | low        | 7      | reached: the model's own query method                          |
| PATCH /documentos/:id            | EI   | 1       | 2   | low        | 3      | `:id`, `nome`                                                 |
| DELETE /documentos/:id           | EI   | 1       | 2   | low        | 3      | `:id`, `motivo`                                               |
| POST /documentos/:id/arquivar    | EI   | 2       | 1   | low        | 3      | `:id`; FTR Documento (loaded) + Sessao (read and written)      |
| POST /pastas/:id/limpar          | EI   | 2       | 1   | low        | 3      | `:id`; FTR Pasta (read) + Documento (deleted row by row)       |
| POST /documentos/:id/atribuir    | EI   | 3       | 2   | average    | 4      | `:id`, `usuarioId`; FTR Documento, Usuario, Historico          |
| POST /documentos/:id/notificar   | EI   | 2       | 1   | low        | 3      | `:id`; FTR Documento + Notificacao — unchanged                 |
| POST /documentos/:id/carimbar    | EO   | 1       | 7   | low        | 4      | `:id`, `alvo` + Documento delivered whole; **1 unresolved call** |
| POST /documentos                 | EI   | 1       | 2   | low        | 3      | `id`, `nome` — the upsert                                     |
| POST /documentos/:id/sessao      | EI   | 2       | 1   | low        | 3      | `:id`; FTR Documento + Sessao                                 |
| POST /pastas/:id/marcar          | EI   | 2       | 1   | low        | 3      | `:id`; FTR Pasta (read) + Documento (each row saved)          |
| POST /perfil                     | EI   | 1       | 1   | low        | 3      | `nome`; FTR Usuario                                           |
| POST /documentos/:id/pasta       | EI   | 2       | 2   | low        | 3      | `:id`, `nome`; FTR Documento (read) + Pasta (written)         |
| POST /documentos/:id/duplicar    | EI   | 1       | 1   | low        | 3      | `:id`; FTR Documento                                          |
| GET /documentos/:id/exportar     | EO   | 1       | 2   | low        | 4      | `:id` + the PDF `response.send(bytes)` delivers — bytes pdf-lib built, **1 opaque DET**, reported as an unreadable delivery (§6); `pdf.save()` is **not** an unresolved write |
| POST /documentos/:id/assinar     | EI   | 2       | 1   | low        | 3      | `:id`; FTR Documento + Assinatura — the model's method's returns name it |
| **total**                        |      |         |     |            | **97** |                                                               |

And `confidence.unresolvedCalls` is **1**, not 0: `alvo.save()` on a receiver whose
type the analysis cannot read. `carimbar` stays an EO because nothing readable was
written — but the count SAYS it does not know, which it did not before.

## The rules

1. A variable of the body is a store when the code says its type, in any of the
   forms already read — `f(x: Store)`, `f(input: Named)` (path `input.x`),
   `f({ x }: { x: Store })` — and in four more:
   - `f({ x }: Named)`: the named interface (same file or imported) is resolved as
     it already is for an identifier parameter, element by element, renames kept
     (`{ documento: doc }`);
   - `const { x } = input`: destructuring a registered path — each element
     inherits the store of `input.x`;
   - `const s = await this.svc.method(a)`: the call is **followed** by the graph,
     and the resolved body's **declared return type** names the store
     (`Promise<Sessao | null>`, `Sessao[]`). No annotation, no binding — nothing
     is guessed;
   - `for (const x of rows)` / `for (const x of parent.relation)`: the loop
     variable is the rows' store, or the declared relation's target.
2. **Type checker not used.** The ts-morph project resolves no `#alias/…`, so
   `getType()` is `any` for almost every receiver; the graph already resolves the
   call to its body, and the body's annotation is the same answer.
3. **A write on a receiver nobody can read is an UNRESOLVED call**, reason
   "write on a receiver whose type the analysis cannot read": `x.save()`,
   `x.delete()` with no arguments (a `Map#delete(key)` has one), `x.merge(…).save()`,
   `x.related('…').create|save|attach|detach|sync(…)`, where `x` is neither a
   store, nor `this`, nor an import, nor a known service. It lowers coverage and
   appears in `fp:inventory`. The transaction stays what the readable code says.
   A local whose value came from a **package** (`await PDFDocument.create()` from
   pdf-lib) is not a store and is not reported: an application model never comes
   out of a package's call. Found on the first recount as two false reports.
3b. The forms the first recount added, because the new report named them — each a
   deterministic reading, none a guess:
   - a **conditional** (`c ? A : B`) or a **default** (`A ?? B`, `A || B`) binds when
     every non-null branch is the same store — `find(id)` or `new Store()`;
   - the **callback parameter** of `map` / `forEach` / `filter` / `find` / `some` /
     `every` / `flatMap` over a store-valued collection (rows, or a relation) is a
     row of it; `rows.filter(…)[0]`, `rows.find(…)` are one row of it too;
   - `auth.user` / `auth.getUserOrFail()` / `auth.use(g).user` is the guard's model,
     read from `config/auth.ts` (`provider: … model: () => import('#…')`); no config,
     no binding;
   - a **relation read off a loaded row** (`documento.pasta`, `intake.distribution`)
     is the declared target;
   - a followed body with **no return annotation** whose every `return` is a store
     access or `new Store()` of the same store names it — the same reading as the
     annotation, one step earlier. Two stores, or a return nobody can read: nothing.
3c. **A method the model declares** (`order.pendingItems(…)`) is application code: its
   return annotation (`ModelQueryBuilderContract<typeof Item>`, `typeof X` names the
   store), or its returns when every one is `Store.query()…`, names the store; a
   query-builder chain after it (`.forUpdate()`, `.where(…)`) hands the same rows on, an
   aggregate (`.count()`) does not. The declared method is read before Lucid's API is
   assumed for the call. Found by a reviewing team as the one writing transaction still
   EO after 0.8.0 — reported as an unreadable write, which is how they found it (plan 0.9 §B).
4. **A service is what the container returns.** `const svc = await
   app.container.make(X)`, with `X` an application class that is not a store,
   binds `svc` to X's file exactly as a constructor-injected property is bound:
   `svc.method()` is followed by `static-service` with no new strategy. A local
   `new X()` already was — the fixture keeps it as the control.

## What `afp@1.6.0` says — printed before the code

Exactly the team's report (for the first seven transactions; the other six were
added after the first recount, and 1.6.0 counts every one of them as an EO or
loses it): five writing transactions as EO (`PATCH` 4, `DELETE`
4, `arquivar` 5, `limpar` 5, `atribuir` 5 FP — each one GAINING points for the
output DETs it does not have), `Documento` an EIF at 5, `Sessao` an EIF at 5,
`Historico` reached by nobody and gone, `notificar` already an EI at 3, `carimbar`
an EO at 4 with **0 unresolved calls and 100% coverage**. Total **57 FP** — four
below the reference, and the four are not the story: two ILFs mistaken for EIFs
(+4), one ILF lost (−7), five EIs sold as EOs (+7). The number was close and the
count was wrong in nine places; only the coverage line could have said so, and it
said 100%.
