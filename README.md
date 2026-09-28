# @filipebraida/adonis-function-points

Function point counting for AdonisJS applications, straight from the source code.

It reads an AdonisJS 7 + Lucid application and produces an IFPUG unadjusted function point
count, following the OMG **Automated Function Points** standard (ISO/IEC 19515). Nothing runs:
no database, no `.env`, no boot. Every number it prints says where it came from — the file, the
rule of the standard, and the origin of each DET and each FTR — because a function point count
that gets invoiced will be disputed, and a number without provenance cannot be defended.

```
$ node ace fp:count

Unadjusted count: 46 FP
Ruleset: afp@1.11.0

type      n     FP
ILF       2     14
EIF       1      5
EI        4     13
EO        3     14

function                                type    DET  FTR   FP
Apontamento                             ILF       4    1    7
Justificativa                           ILF       3    1    7
Pessoa                                  EIF       4    1    5
GET /apontamentos                       EO        4    1    4
POST /apontamentos                      EI        3    1    3
PUT /apontamentos/:param                EI        5    2    4
DELETE /apontamentos/:param             EI        1    2    3
POST /apontamentos/justificar           EI        4    2    3
GET /presenca                           EO       14    3    5
GET /presenca/relatorio                 EO       14    3    5
```

## Quick start

```bash
npm i -D @filipebraida/adonis-function-points
node ace configure @filipebraida/adonis-function-points

node ace fp:count                        # the count
node ace fp:explain "POST /apontamentos" # why one function came out that way
```

For CI, or a one-off count of a project you do not want to touch, the standalone binary needs no
install in the application:

```bash
npx @filipebraida/adonis-function-points count --root ./my-app
```

Both front-ends run the same code and cannot disagree about a number. How a pull request becomes
two counts and a comparison: [`docs/ci.md`](docs/ci.md).

## What it counts, and how it reads the application

- **Data functions** are the Lucid models, with their columns from the model or from the
  generated schema. A table the application writes is an **ILF**; one it only reads is an
  **EIF**. A `hasMany`/`hasOne` child that no code addresses on its own folds into its parent as
  a **RET**. Technical tables (sessions, tokens, lookups) are left out by the standard's naming
  filter, with the reason in the report.
- **Transactions** are the HTTP routes and the ace commands. From each handler the analysis walks
  the call graph — actions, services, events and their listeners, dispatched jobs, transformers,
  local and imported functions — and records every store it reads or writes, through the models
  or through the raw query builder (`db.from('orders')`, `db.rawQuery(sql)`). A transaction that
  writes is an **EI**, one that only reads is an **EO**. A route that reaches no data is not a
  transaction, and is listed, not dropped.
- **DETs** come from what crosses the boundary: the validator's fields and what is read off the
  request on the way in; on the way out, what the transaction delivers — the props handed to the
  page, the response payload, the keys a transformer returns, the columns a `select` names.
  Identifiers and framework timestamps are not DETs.
- **Packages are outside the boundary.** Their code is never followed: what a package does with
  its own tables is technical, and what it hands back is a value.

The reasoning behind each of these, with the rule of the standard that settles it:
[`docs/design/counting-decisions.md`](docs/design/counting-decisions.md).

## Every number is explained

```
$ node ace fp:explain "POST /apontamentos"

POST /apontamentos  —  EI, low complexity, 3 FP
module: ponto

Rule applied: afp:6.5.3 modifies a data store -> EI

DET = 3
  validator:registrarPontoValidator.marcadoEm
  validator:registrarPontoValidator.pessoaId
  validator:registrarPontoValidator.tipo

FTR = 1
  reaches:Apontamento

Path walked:
  controllers/apontamentos_controller.ts#store  (store)
    actions/registrar_ponto.ts#handle  (action-object) [writes]
```

What the analysis could not read is not hidden. Below the count, a **confidence** block lists it:

- calls it could not follow, one per site, with the reason — they lower the coverage;
- routes that did not become a function, and why (no handler, reaches no data store);
- values counted as a floor (a JSON column, an open validator, a page it could not read);
- `GET` routes counted as EI because they write — for a person to confirm (see
  [a write that does not decide the type](#a-write-that-does-not-decide-the-type));
- every declaration in the configuration and what it changed.

`fp:inventory` prints the full lists; `--json` gives them to a script.

## Commands

| command                               | what it does                                                  |
| ------------------------------------- | ------------------------------------------------------------- |
| `node ace fp:count`                   | the unadjusted function point count                           |
| `node ace fp:explain <name>`          | why one function was counted that way                         |
| `node ace fp:inventory`               | the raw facts: stores, routes, coverage, what was not counted |
| `node ace fp:metrics`                 | density, coupling and conformance, from the same run          |
| `node ace fp:diff <a.json> [b.json]`  | additions, modifications and deletions, and the billable FP   |
| `node ace fp:calibrate <samples.csv>` | correction factors against a manual count                     |

The standalone binary takes the same commands (`count`, `explain`, `inventory`, …) and these
options:

```
--root <path>            application to analyse (default: the current directory)
--out <path>             write the result as JSON to this path
--json                   print JSON instead of text
--min-coverage <0..1>    fail below this tracing coverage
```

Every command exits non-zero when it cannot produce a number it can stand behind — coverage below
the minimum, an unreadable configuration, two counts made under different rules — so a CI job
fails instead of publishing it.

`fp:metrics` is the counterweight: if function points pay, a team is paid to add models and
endpoints. Density, coupling and conformance come from the same run and sit beside the number —
[`docs/metrics.md`](docs/metrics.md).

## Measuring change

`fp:count --out count.json` saves a count; `fp:diff` compares two of them, or one against the
current code. Functions are matched by identity, so moving a controller between modules is not a
deletion plus an addition.

Each difference is priced by the factors the contract names: OMG **AEP** by default, or
`diff: { preset: 'sisp' }` for the Roteiro de Métricas do SISP (inclusão 1,00, alteração × 0,63,
exclusão 0,50). A modification is split by **why** it changed — type, size, or implementation only
— so a refactor is visible before it is billed at full value, and `diff.reasonFactors` prices each
reason by the contract. Every line carries the factor it was billed at and its weighted value; the
total is their rounded sum.

**Measuring a piece of work** — an issue, a sprint — means the net change of each function it
touched:

- **contiguous work** (a branch, a merge request): count its base and its head, then
  `fp:diff base.json head.json`;
- **commits interleaved with other work** on the main branch: the span from the first commit to
  the last includes everything else that landed in between. Diff each of its commits against its
  parent, and consolidate each function by its ends — its state before the first commit that
  touched it, and after the last.

Never the plain sum of per-commit diffs: a function created in one commit and changed in the next
is one inclusion, not an inclusion and a modification.

## Configuration

Everything technical — aliases, layout, generated files, where the models live — is discovered
from the application. What is configurable is what only a person can decide: the boundary of the
application, and what the analysis cannot see. **Nothing in the application's code has to change
for the count:** where the analysis cannot see something, it says so, and the configuration
answers.

```ts
// config/function_points.ts
import { defineConfig } from '@filipebraida/adonis-function-points'

export default defineConfig({
  boundary: {
    infrastructure: ['audits'], // technical: excluded, with the reason in the report
    externallyMaintained: ['erp_customers'], // another system maintains it: an EIF
    business: ['chat_sessions'], // user data the naming filter caught by mistake
    ignoreEntryPoints: ['GET /health'],
  },
  maxDepth: 3, // how far to follow the call graph
  minCoverage: 0.85, // below this, the count fails
  messageDet: 0, // 1 adds the confirmation-message DET a manual count includes
})
```

Every run prints which configuration produced it. A configuration file that exists and fails to
load is an error: the count is not produced, rather than silently falling back to the defaults.
Every option has an effect, and a declaration that matched nothing is reported.

### A table no model reads

A package's migration may create a table the application reads or writes through the raw query
builder, with no model for it. Name it in `boundary.business`, `boundary.externallyMaintained` or
`boundary.infrastructure`: its columns come from the generated schema, and the report lists it as
counted by declaration. Undeclared, each access to it is listed as an unresolved call.

### Data the analysis cannot see at all

Some data the user recognises is reached by a path static analysis does not follow: a table a
package maintains through its own API, settings kept in a persistent cache, records read from
another system over HTTP. Declare each one as a logical file — where its structure comes from,
and which calls read or write it:

```ts
logicalFiles: {
  Role: {
    table: 'authz_roles', // structure from the generated schema
    writes: [/\bauthz\.store\.(createRole|deleteRole)$/], // a package's API, by callee
    reads: [/\bauthz\.store\.listRoles$/],
    reason: 'roles the administrator maintains through the authorization package',
  },
  Settings: {
    type: 'Settings', // a type, an interface or a DTO class of the application
    exclude: ['updatedAt'],
    reads: ['SettingsService.get'], // an application method, by name
    writes: ['SettingsService.update'], // declare the write where the intent is
    reason: 'deadlines set by the administrator, kept in a persistent cache',
  },
},
```

A declared write makes the transaction an EI and the file an ILF; a read makes it an FTR. The
report lists every declared file, where its DETs came from, and the function points it
contributes.

### A call that reaches no data

A call the analysis cannot follow lowers the coverage. When it is known to reach no data — a rate
limiter, an attachment's URL — say so:

```ts
import { ignoreCalls } from '@filipebraida/adonis-function-points'

export default defineConfig({
  resolvers: {
    call: [
      ignoreCalls({ name: 'login-limiter', matching: /^this\.loginLimiter\./ }),
      ignoreCalls({ name: 'attachment-variants', methods: ['getUrl', 'getVariant'] }),
    ],
  },
})
```

### A write that does not decide the type

A transaction is classified by its primary intent. A page that counts its own visit, or creates a
default the first time it is opened, writes — and is still a page. The count lists every `GET`
counted as EI with what it writes; where the write only supports the page, declare it:

```ts
import { incidentalWrites } from '@filipebraida/adonis-function-points'

incidentalWrites({ name: 'visits', methods: ['recordVisit'] })

// incidental on these pages, but the point of another route (a user switching organisation):
incidentalWrites({
  name: 'remembered organisation',
  methods: ['rememberOrganisation'],
  in: ['GET /orders/:param', 'GET /customers/:param'],
})
```

The store stays maintained — an ILF and an FTR — and only the classification changes. A route not
listed in `in`, including one added later, stays an EI and keeps appearing in the list.

### A value the analysis cannot read

A JSON column whose fields live in a schema, an open validator: each counts as 1 DET, a floor, and
is named in the report. Declare where the fields are, by origin, and the declaration reaches every
function that carries it:

```ts
opaque: {
  'Survey.answers': { schemas: 'surveySchema', reason: 'the form is a JSON Schema in the seed' },
},
```

`overrides.<function>.det` remains for a structure that exists only in the database. Both require
a reason, printed by `fp:explain` beside the number.

### A code pattern the analysis does not know

The call graph is followed by a list of strategies, most specific first: `same-class-method`,
`action-object`, `event-dispatch`, `job-dispatch`, `transformer`, `static-service`,
`property-service`, `local-function`, `module-function`. A project with its own convention adds
one; the first strategy that claims a call wins.

```ts
import type { CallResolver } from '@filipebraida/adonis-function-points'

const repositoryResolver: CallResolver = {
  name: 'my-repository',
  order: 5, // lower runs first; custom strategies run before the built-ins
  resolve(call, ctx) {
    return [] // the bodies to follow, or [] when the call is not this pattern
  },
}

export default defineConfig({ resolvers: { call: [repositoryResolver] } })
```

## Support

| application           | supported                                                    |
| --------------------- | ------------------------------------------------------------ |
| AdonisJS 7 + Lucid 22 | **yes** — generated schema, `codegen`, with or without Tuyau |
| AdonisJS 6 / Lucid 21 | no — detected and reported                                   |
| Kysely and other ORMs | no — detected and reported                                   |

An unsupported application is told so. The package never counts zero in silence.

## Known limitations

Most come from the AFP standard itself:

- **EQ is counted as EO.** Telling an inquiry from an output needs to know whether the output
  derives data, which static analysis cannot see; AFP mandates the collapse.
- **RET comes from usage.** A child table folds into its parent only when no code addresses it on
  its own — the only signal the code gives. A child of two parents stays apart, and is reported.
- **Confirmation and error messages** count 1 DET in a manual count and are invisible here;
  `messageDet: 1` restores them.
- **VAF is not calculated.** The general system characteristics need human judgement; AFP fixes
  VAF = 1, and the unadjusted count is what public contracts in Brazil use.
- **A modification is priced by a flat factor.** AEP grades it by effort complexity, which needs
  cyclomatic complexity this package does not measure. What it does separate is why a function
  changed, and `diff.reasonFactors` prices that by the contract.
- **Structure that lives only in the database** — a form stored as data, a schema in a seed — is a
  floor until declared (`opaque`, `overrides`).

## Benchmark

The one reference in this project not produced by its authors is the case study in **Vazquez,
Simões & Albert (2011)**: 46 FP by hand, **46 FP** here, 8 of 10 functions exact, and the two that
differ predicted in writing before the run — [`docs/benchmark.md`](docs/benchmark.md).

## References

- **OMG Automated Function Points (AFP) 1.0** — ISO/IEC 19515:2019: technical data (§6.5.2.1),
  transaction detection (§6.5.3), ILF vs EIF by maintenance (§6.5.4), DET/RET/FTR (§7.2, §7.3).
- **OMG Automated Enhancement Points (AEP) 1.0** — added, modified and deleted functions (§6.3)
  and their factors (§6.5), the basis for `fp:diff`.
- **IFPUG Counting Practices Manual (CPM) 4.3** — the method AFP automates.
- **Roteiro de Métricas de Software do SISP 3.0** — the `sisp` preset of `fp:diff`.
- **Vazquez, C. E., Simões, G. S., Albert, R. M. (2011).** _Análise de Pontos de Função: Medição,
  Estimativas e Gerenciamento de Projetos de Software._ Érica.
- **Pinel, B. (2012).** _Ligeiro: uma ferramenta para contagem automática de pontos de função._
  COPPE/UFRJ. [pesc.coppe.ufrj.br](https://pesc.coppe.ufrj.br/uploadfile/1343153707.pdf)

## Design documents

- [`docs/design/counting-decisions.md`](docs/design/counting-decisions.md) — each edge case, and
  the rule of the standard that settles it
- [`docs/design/architecture.md`](docs/design/architecture.md) — principles, layers, and what is
  discovered instead of configured
- [`docs/design/resolvers.md`](docs/design/resolvers.md) — the code patterns and how each is
  followed
- [`docs/ci.md`](docs/ci.md), [`docs/metrics.md`](docs/metrics.md),
  [`docs/benchmark.md`](docs/benchmark.md)

## Contributing

```bash
pnpm install
pnpm test                                    # lint + the suite, from source
pnpm run compile && pnpm run test:package    # the packed tarball, installed and used
```

A fixture with a hand-written reference count comes **before** the code, and nothing is dropped
in silence. The rest is in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT
