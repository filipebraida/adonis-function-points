# ace_commands — reference count

Fixture for plan 0.7 §C: an **ace command is an elementary process**. IFPUG
counts batch processes an operator starts; `node ace noticias:importar` reads a
feed and writes news, which is an EI exactly like a `POST`. Until this, the
collector emitted only `kind: 'http'`, although the type had `command` and §5 had
decided its identity (`commandName`) since 0.1.0. Written before the code.

## The application

| store       | columns (besides `id`)                          | role                                                              |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `Noticia`   | `titulo`, `slug`, `corpo`, `fonte`, `publicadaEm` | written only by commands — maintained by a batch process: **ILF** |
| `Assinante` | `nome`, `email`, `ativo`                        | read by a report, maintained by nobody here: EIF                  |

One route and four commands, each one shape:

| entry point                | shape                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /noticias`            | the control: an HTTP EO, counted as before                                                  |
| `ace noticias:importar`    | writes `Noticia`; 3 `@flags` — an EI whose input DETs are the flags                         |
| `ace assinantes:relatorio` | reads `Assinante`, prints `nome` and `email` in a table and a count — an EO                 |
| `ace gerar:noticias`       | writes `Noticia` with `@faker-js/faker` — a generator: **counted**, and named with a hint    |
| `ace make:widget`          | writes a file, reaches no store — no transaction (AFP §6.5.3), as a static route falls out   |

## Reference: 26 unadjusted FP

| function                   | type | FTR/RET | DET | complexity | FP     | DET origin                                                          |
| -------------------------- | ---- | ------- | --- | ---------- | ------ | ------------------------------------------------------------------- |
| Noticia                    | ILF  | 1       | 5   | low        | 7      | columns, minus `id`                                                 |
| Assinante                  | EIF  | 1       | 3   | low        | 5      |                                                                     |
| GET /noticias              | EO   | 1       | 5   | low        | 4      | Noticia, whole                                                      |
| ace noticias:importar      | EI   | 1       | 3   | low        | 3      | `flag:limite`, `flag:desde`, `flag:atualizar`                        |
| ace assinantes:relatorio   | EO   | 1       | 4   | low        | 4      | `flag:ativos` (the `flagName`, not the property) + `nome`, `email` printed in the table + the count, one value — as `total: produtos.length` is on a page; the headers are labels, not fields |
| ace gerar:noticias         | EI   | 1       | 1   | low        | 3      | `flag:quantidade`                                                   |
| **total**                  |      |         |     |            | **26** |                                                                     |

With `boundary.ignoreEntryPoints: ['gerar:noticias']` (the `commandName`, or the
identity `ace gerar:noticias`): **23**.

## The rules

1. Every class in `commands/**` extending `BaseCommand` from `@adonisjs/core/ace`
   with a literal `static commandName` is an entry point: `kind: 'command'`,
   trigger `ace`, signature the command name, body `run()`. Identity, per §5, is
   the command name — rendered `ace <commandName>` the way HTTP renders
   `<verb> <pattern>`.
2. It follows the same strategies as a handler; classification and FTR by the
   graph, as today. A command that reaches no store is not a transaction.
3. **Input DETs are the `@flags.*` and `@args.*` declared** on the class — exact,
   better than a validator. The name is the flag's (`flagName` when given), the
   thing the operator types.
4. **Printing is delivery.** `this.ui.table().row([…])`, `this.logger.info(…)`,
   `console.log(…)`: what a report hands to the terminal is what leaves, read by
   the same classifier as `inertia.render` props — a field read off a row is one
   DET named after it, a template's expressions are its values, a count is one.
   The plan had "1 per store, opaque"; the classifier can read a table's rows, so
   it does.
4b. A model imported **inside** the body — `const { default: Noticia } = await
   import('#models/noticia')`, which commands do so `--help` does not boot the
   app — binds the store like a static import. A real importer wrote four tables
   this way and touched nothing.
5. **A generator is counted.** Half the commands on the validated applications
   are development tools (`gerar:egressos`, `intakes:seed`, `make:module`). The
   code cannot separate an importer from a generator — both write the table — and
   inventing that rule would be guessing. So every command reaching data is
   counted, and the report lists each with its FP, saying a development tool is
   excluded with `boundary.ignoreEntryPoints`; a file importing `@faker-js/faker`
   carries the note "generates data: probably a tool" on its line.

The first draft of this table had `relatorio` at 3 DET, arguing the count was
"the rows'". It is not: `produtos.length` delivered to a page is one DET
(`render:total`, render_props), and a count printed to a terminal is the same
value. 4 DET, same band, same 4 FP — corrected before the code ran.

## Jobs nobody dispatches (plan §D) — reported, not counted

Three jobs, one per case; none changes a number above:

| job                 | who reaches it                                          | report                                                                          |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `IndexarNoticiaJob` | dispatched by `noticias:importar` — part of that EI (§9) | nothing                                                                         |
| `PodarNoticiasJob`  | `start/scheduler.ts` schedules it; no transaction        | "scheduled from start/scheduler.ts, outside every transaction: a process nobody counts" |
| `EnviarBoletimJob`  | nothing in the application                              | "dispatched by nothing: dead code, or a scheduler this analysis does not read"  |

A fourth case exists on the validated applications and has its own line: a job
dispatched from a service that **no transaction reaches** — "dispatched from
app/ai/services/language_model_service.ts, which no transaction reaches". The
dispatcher is unreached code, not a scheduler, and saying "scheduled" would name
a thing that is not there.

A scheduled job is an elementary process — and it is **not counted**, because
inventing one is the error this package exists to avoid. When a scheduler appears
on a real application it becomes an entry point `job:<Class>` with the identity §5
already decided; until then the report says what it saw. `PodarNoticiasJob`
deletes `Noticia`: that write still makes `Noticia` maintained here (§6.5.4 asks
who maintains the store, not which route), which is why it stays an ILF whatever
the report says about the job.

## What `afp@1.5.0` says

Commands do not exist. Nothing in the HTTP surface writes `Noticia`, so it is an
EIF at 5; `Assinante` is reached by nobody and drops out (§6.5.4); `GET /noticias`
is 4 — **9 FP**. The commands add 10 FP of their own and, by writing `Noticia`,
make it what it is: an ILF this application maintains, in batch — 7, and
`Assinante` an EIF the report reads, 5. 9 → 26.

The first draft of this file summed the table to 22 and the excluded total to 19:
the same six rows, added wrong (the control route's 4 FP left out). The rows were
right; the arithmetic was corrected when the first count printed 26 and every
function matched its row.
