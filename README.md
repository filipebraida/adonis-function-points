# @filipebraida/adonis-function-points

Automated function point counting and code metrics for AdonisJS applications.

Counts IFPUG function points straight from the source, following the OMG
**Automated Function Points** standard (ISO/IEC 19515). Every number it prints
says where it came from: the file, the line, the rule from the standard, and the
origin of each DET and each FTR.

```bash
node ace fp:count
```

```
Unadjusted count: 46 FP
Ruleset: afp@1.5.0

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
GET /presenca                           EO       13    3    5
GET /presenca/relatorio                 EO       13    3    5
```

## Install

```bash
npm i @filipebraida/adonis-function-points
node ace configure @filipebraida/adonis-function-points
```

Requires **AdonisJS 7** and **Lucid 22** (see [Support](#support)). In CI, or
for a one-off count on a project you do not want to touch, the standalone
binary needs no install, no `.env` and no database:

```bash
npx @filipebraida/adonis-function-points count --root ./my-app
```

Both front-ends call the same code and cannot disagree about a number. Which
one to use where, what a saved count records, and how a pull request becomes
two counts and a comparison: [`docs/ci.md`](docs/ci.md).

## Commands

| command                               | what it does                                               |
| ------------------------------------- | ---------------------------------------------------------- |
| `node ace fp:count`                   | counts unadjusted function points                          |
| `node ace fp:inventory`               | the raw facts: stores, routes, tracing coverage            |
| `node ace fp:metrics`                 | density, coupling and conformance, from the same run       |
| `node ace fp:explain <name>`          | why one function was counted that way                      |
| `node ace fp:diff <previous.json>`    | additions / modifications / deletions, and the billable FP |
| `node ace fp:calibrate <samples.csv>` | correction factors against a manual count                  |

`fp:count --out count.json` saves a count; `fp:diff count.json` compares that
saved count against the current state of the application. It deliberately does
**not** take a git ref: booting an older checkout, with possibly different
dependencies, is a problem not worth solving.

```
adonis-function-points <command> [options]

  count                    count the unadjusted function points
  inventory                the raw facts: stores, routes, tracing coverage
  explain <name>           why one function was counted that way
  metrics                  density, coupling and conformance, from the same run
  diff <previous.json>     additions / modifications / deletions, and billable FP
  calibrate <samples.csv>  correction factors against a manual count

  --root <path>            application to analyse (default: the current directory)
  --out <path>             write the result as JSON to this path
  --json                   print JSON instead of a table
  --min-coverage <0..1>    fail below this tracing coverage
```

Every command exits non-zero when the count cannot be produced — coverage
below the minimum, an unreadable configuration, a saved count from a different
rule set — so a CI job fails instead of publishing a number nobody can defend.

### `fp:explain` — the number has to be defensible

```
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

If function points get invoiced, someone will dispute a number — and a number
without provenance is indefensible.

### `fp:metrics` — the counterweight

If function points pay, the team optimises function points: more models, more
endpoints, less reuse. Density, coupling, instability and conformance come free
from the same inventory and are reported beside the number — what each metric
means and what it deliberately does not measure: [`docs/metrics.md`](docs/metrics.md).

### `fp:diff` — what change is worth

Additions, modifications and deletions between two saved counts, priced by the
factors the contract names: AEP by default, or `diff: { preset: 'sisp' }` for the
Roteiro de Métricas do SISP v3.0 (inclusão 1,00, alteração × FI 0,63, exclusão
0,50; `factors: { changed: 0.84 }` when the contractor did not develop the function). A modification is split by **why** it changed —
type, size, or implementation only — so a refactor is visible before it is
billed at full value. The reasoning, and what the default leaves on the table:
[counting-decisions §5](docs/design/counting-decisions.md#5-identity-of-a-function-across-versions-fpdiff).

## Configuration

Discovery does the technical work — subpath aliases, generated artefacts,
layout, scan roots are all read from the application, never assumed. What stays
configurable is what is a **business decision** that no heuristic should make.

**Every option here has an effect, and a test proving it.** Configuration the
code does not honour is worse than none at all.

```ts
// config/function_points.ts
import { defineConfig } from '@filipebraida/adonis-function-points'

export default defineConfig({
  boundary: {
    infrastructure: ['access_tokens', 'audits'], // excluded, with the reason in the report
    externallyMaintained: ['erp_customers'], // counted as EIF instead of ILF
    business: ['chat_sessions'], // the AFP naming filter caught it by accident
    // technicalPatterns: [...DEFAULT_TECHNICAL_PATTERNS], // replaces the filter's naming list
    ignoreEntryPoints: ['prometheus.metrics'],
  },

  dataFunctions: { grouping: 'usage' }, // 'none' keeps every table its own data function
  maxDepth: 3, // how far to follow the call graph
  messageDet: 0, // 1 restores the IFPUG confirmation-message DET
  minCoverage: 0.85, // below this, the analysis fails
})
```

`complexityTables` and `weights` are also accepted, for calibrating the bands
against a manual count.

Both front-ends load this file from the application root, and every run prints
which configuration produced it — the file path, or `defaults` when there is
none. A configuration file that exists and fails to load is an **error**: the
count is not produced. Falling back to the defaults with a warning would change
the number without telling anyone, and the number becomes an invoice.

### Custom code pattern

```ts
import type { CallResolver } from '@filipebraida/adonis-function-points'

const repositoryResolver: CallResolver = {
  name: 'my-repository',
  order: 5, // lower runs first; custom strategies run before the built-ins
  resolve(call, ctx) {
    // return the bodies to follow, or [] if this is not your pattern
    return []
  },
}

export default defineConfig({
  resolvers: { call: [repositoryResolver] },
})
```

The **first** strategy that claims a call wins. That is not an implementation
detail: `CreateUserJob.dispatch(p)`, `UserService.create(p)` and `User.find(p)`
are all `Identifier.method(args)`, and only ordering tells them apart.

Built-in strategies, most specific first: `same-class-method`, `action-object`,
`event-dispatch`, `job-dispatch`, `transformer`, `static-service`,
`property-service`, `module-function`.

A job dispatch and an event dispatch are followed as part of the **same**
transaction: the user clicks and the effect happens, whatever thread runs it.
Event bindings are read from `emitter.on(event, [listeners])`, so a listener's
reads and writes count towards the transaction that dispatched the event.

### Declaring that a call reaches no data

`resolve` has two outcomes — _followed_ and _not mine_ — and sometimes a third
is the truth: the call is recognised, and it reaches no data store. A wrapper
over a rate limiter or an attachment variant is a real example. Without a way
to say so, such a call stays unresolved and drags the coverage gate down.

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

Or, for a shape the factory does not cover, a strategy with `ignores(call)`
returning `true` — "this is mine, and it touches no data store". `ignores` is
asked before `resolve`, in the same order, so a later and more generic strategy
cannot follow the call into a body it has no business reading. It stays a
**named** strategy on purpose: the volume it declared data-free still appears in
the confidence block of `fp:count`, because a silent drop is the worst defect
this package can have — whoever writes it.

## Support

|                       | v1                                                           |
| --------------------- | ------------------------------------------------------------ |
| AdonisJS 7 + Lucid 22 | **yes** — generated schema, `codegen`, with or without Tuyau |
| AdonisJS 6 / Lucid 21 | no — detected and reported                                   |
| Kysely and other ORMs | no — detected and reported                                   |

Out of scope, the package says it does not support the application. It never
counts zero in silence.

## Known limitations

Inherited from the AFP standard itself, not from this implementation:

- **EQ is collapsed into EO.** Telling an inquiry from an output requires
  knowing whether there is derived data or calculation, which static analysis
  cannot see. AFP mandates the collapse.
- **RET comes from usage, not from the user's view.** A `hasMany`/`hasOne`
  child that no application code addresses directly folds into its parent as a
  RET; one that has its own queries stays its own data function. That is the
  only signal static analysis has, and it is conservative: it groups only when
  the code cannot see the child apart from the parent. A child hanging off two
  parents stays apart and is reported.
- **Confirmation and error messages** count 1 DET in a manual count and are
  invisible here — a known systematic divergence of −1 DET per transaction.
  `messageDet: 1` restores it.
- **VAF is not calculated.** The 14 general system characteristics require human
  judgement. AFP fixes VAF = 1, and the unadjusted count is what public
  contracts in Brazil use anyway.
- **The modification factor in `fp:diff` is 1.** AEP grades it from 0.25 to
  1.75 through Effort Complexity, which needs cyclomatic complexity this package
  does not measure. A flat 1 prices a one-line fix and a rewrite the same, and
  the report says so with the amount at stake. What it does discriminate is
  **why** a function changed — type, size, or implementation only — and
  `diff.reasonFactors` prices a refactor by the contract rather than by a number
  the tool invented. See counting-decisions §5.
- **Schema-driven applications undercount their input.** When the fields a user
  fills live in a JSON column whose schema is stored in the database, there is
  nothing for static analysis to read: the column counts as 1 DET — a floor,
  and `fp:count` names it on every run. The way out is to declare where the
  fields live, by origin, and the declaration reaches every function that
  carries the column:

  ```ts
  opaque: {
    'Survey.answers': { schemas: 'surveySchema', reason: 'the form is a JSON Schema in the seed' },
  }
  ```

  The reason is required, `fp:explain` prints it beside the number, and
  `fp:count` reports what share of the total came from a declaration.
  `overrides.<fn>.det` remains for a schema that lives only in the database.
  See counting-decisions §8.

- **Only HTTP routes are collected as entry points.** An ace command that
  imports a spreadsheet and a scheduled job are transactional functions under
  IFPUG; they are out of v1.

## Benchmark

The only reference in this project not produced by its own authors is the case
study in **Vazquez, Simões & Albert (2011)**: 46 FP by hand, **46 FP** here, 8 of
10 functions exact and the two that differ predicted in writing before the run.
How the fixture was frozen, what Ligeiro got, and why the total is more
defensible than any single function: [`docs/benchmark.md`](docs/benchmark.md).

## References

- **OMG Automated Function Points (AFP) 1.0** — ISO/IEC 19515:2019. The
  normative basis for the count: technical data filter (§6.5.2.1.1), transaction
  detection (§6.5.3), ILF vs EIF by maintenance (§6.5.4), DET/RET/FTR (§7.2,
  §7.3).
- **OMG Automated Enhancement Points (AEP) 1.0** — the basis for `fp:diff`:
  added / modified / deleted (§6.3) and the complexity factors (§6.5).
- **IFPUG Counting Practices Manual (CPM) 4.3** — the underlying method AFP
  automates.
- **Vazquez, C. E., Simões, G. S., Albert, R. M. (2011).** _Análise de Pontos de
  Função: Medição, Estimativas e Gerenciamento de Projetos de Software._ Érica.
  The benchmark case study.
- **Pinel, B. (2012).** _Ligeiro: uma ferramenta para contagem automática de
  pontos de função._ COPPE/UFRJ.
  [pesc.coppe.ufrj.br](https://pesc.coppe.ufrj.br/uploadfile/1343153707.pdf)

## Design documents

The reasoning behind the count lives with the code:

- [`docs/design/architecture.md`](docs/design/architecture.md) — why the package
  exists, its principles, the layers, and what is discovered instead of configured
- [`docs/design/counting-decisions.md`](docs/design/counting-decisions.md) —
  each edge case, with the AFP rule that settles it
- [`docs/design/resolvers.md`](docs/design/resolvers.md) — the catalogue of code
  patterns and how each is followed
- [`docs/benchmark.md`](docs/benchmark.md), [`docs/ci.md`](docs/ci.md),
  [`docs/metrics.md`](docs/metrics.md)

Three further documents are kept as a **dated record** of how the design was
arrived at, in Portuguese, and are not a reference for current behaviour:
[`implementation-plan.md`](docs/design/implementation-plan.md),
[`adonisjs-variation.md`](docs/research/adonisjs-variation.md) and
[`external-validation.md`](docs/research/external-validation.md).

## Contributing

```bash
pnpm install
pnpm test                                    # lint + the suite, from source
pnpm run compile && pnpm run test:package    # the packed tarball, installed and used
```

Two house rules: a fixture with a known answer comes **before** the code, and a
silent drop is the worst possible defect. The rest is in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT
