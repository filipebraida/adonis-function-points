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
Ruleset: afp@1.0.0

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

## Why

Software factories bill by function point, and the count is manual, slow, and
varies from counter to counter. Commercial automated counters exist for
enterprise legacy, but **no modern framework has one** — not Laravel, not Rails,
not AdonisJS. What those ecosystems do have (`rails stats`, `laravel-stats`,
`adonisjs-stats`) counts classes and lines, which is a different thing.

This package implements the OMG **Automated Function Points** specification,
which defines how to automate IFPUG CPM by replacing the subjective judgements
with deterministic rules.

## Install

```bash
npm i @filipebraida/adonis-function-points
node ace configure @filipebraida/adonis-function-points
```

Requires **AdonisJS 7** and **Lucid 22** (see [Support](#support)).

### Or run it without installing

For CI, or a one-off count on a project you do not want to touch:

```bash
npx @filipebraida/adonis-function-points count --root ./my-app
```

Nothing is booted either way — the engine only reads files — so a standalone
run needs no `.env`, no database, and no install inside the analysed project.
The standalone binary **does not replace installing**: a project that installs
the package keeps the `node ace fp:*` commands, and both front-ends call the
same code, so they cannot disagree about a number.

```
adonis-function-points <command> [options]

  count                    count the unadjusted function points
  inventory                the raw facts: stores, routes, tracing coverage
  explain <name>           why one function was counted that way
  diff <previous.json>     additions / modifications / deletions, and billable FP
  calibrate <samples.csv>  correction factors against a manual count

  --root <path>            application to analyse (default: the current directory)
  --out <path>             write the result as JSON to this path
  --json                   print JSON instead of a table
  --min-coverage <0..1>    fail below this tracing coverage
```

Both front-ends exit non-zero when the count cannot be produced — coverage
below the minimum, an unreadable configuration, a saved count from a different
ruleset — so a CI job fails instead of publishing a number nobody can defend.

#### In CI

Every count records what it counted, so the artefact stands on its own once it
leaves the pipeline:

```json
"source": {
  "app": "shop",
  "revision": "adef4ee3…",
  "branch": "main",
  "dirty": false,
  "countedAt": "2026-09-24T17:40:11.000Z",
  "config": "/app/config/function_points.ts"
}
```

`dirty` is the field that matters in billing: a count taken over uncommitted
changes cannot be reproduced from any revision, and whoever receives the
invoice is entitled to know that. `app` is the manifest name, never an absolute
path — a path would say where your machine keeps its files and travel with
every count you send anywhere.

`fp:diff` refuses two counts of different applications, the same way it refuses
two different rulesets, and warns when either side is dirty or when both are
the same revision.

Counting an older revision needs no checkout of your working tree and nothing
installed in it, so a pull request is two counts and a comparison:

```yaml
- run: git worktree add ../base ${{ github.event.pull_request.base.sha }}
- run: npx @filipebraida/adonis-function-points count --root ../base --out base.json
- run: npx @filipebraida/adonis-function-points count --out head.json
- run: npx @filipebraida/adonis-function-points diff base.json head.json
```

The package does not deliver the result anywhere — an artifact, a ledger
branch, a billing endpoint and a PR comment are all yours to choose. What it
owes you is a number that is still defensible wherever it lands.

## Commands

| command                               | what it does                                               |
| ------------------------------------- | ---------------------------------------------------------- |
| `node ace fp:count`                   | counts unadjusted function points                          |
| `node ace fp:inventory`               | the raw facts: stores, routes, tracing coverage            |
| `node ace fp:explain <name>`          | why one function was counted that way                      |
| `node ace fp:diff <previous.json>`    | additions / modifications / deletions, and the billable FP |
| `node ace fp:calibrate <samples.csv>` | correction factors against a manual count                  |

`fp:count --out count.json` saves a count; `fp:diff count.json` compares that
saved count against the current state of the application. It deliberately does
**not** take a git ref: booting an older checkout, with possibly different
dependencies, is a problem not worth solving.

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

## Benchmark

The only reference in this project not produced by its own authors is the case
study published in **Vazquez, Simões & Albert (2011)**, the same one used by the
COPPE/UFRJ dissertation on the _Ligeiro_ tool (Pinel, 2012).

The fixture and the reference count were frozen in their own commit **before**
the counter was ever run against them, with the transcription choices written
down first. Without that the independence would be illusory.

|                                     | total     | vs reference |
| ----------------------------------- | --------- | ------------ |
| **Vazquez et al. (2011), manual**   | **46 FP** | —            |
| **this package**                    | **46 FP** | **0%**       |
| Ligeiro, automated (Pinel 2012)     | 52 FP     | +13%         |
| Ligeiro, manual under its own rules | 43 FP     | −6.5%        |

Eight of the ten functions match exactly. The two that do not were **predicted
in writing before the run**, and come from the standard rather than from
defects:

- **+1** `Consulta Apontamento Diário` is an EQ in the reference; AFP §6.5.3
  requires collapsing EQ into EO, and an EO weighs more in the same band.
- **−1** `Apontamento c/ Justificativa`: the IFPUG manual counts 1 DET for the
  user message, AFP does not.

They cancel out, which is exactly why the total is reported alongside the
function-by-function agreement rather than on its own.

Reproduce it with `npm test` — the benchmark is
`tests/acceptance/vazquez.spec.ts`, and the reference is
[`tests/fixtures/apps/vazquez/REFERENCE.md`](tests/fixtures/apps/vazquez/REFERENCE.md).

## Principles

**Traceability.** Every counted function says where it came from: file, line,
rule applied, origin of each DET and each FTR, and the path walked through the
call graph. The ruleset is versioned and printed in every report — two counts
are only comparable if the rules did not change in between.

**Say "I don't know" rather than be wrong in silence.** A call the tracer cannot
follow enters the coverage metric. If coverage falls below the configured
threshold, the analysis **fails** instead of emitting a number that looks right.
This is not a preference; AFP §6.5.3 requires it:

> "If the transaction execution depends on code that is unknown or unavailable
> to the automated tool, the code end point shall be cataloged and listed in the
> generated report in order to detect and quantify the missing patterns and
> libraries."

**Shape must not change the count.** The same logical application written in
different ways — flat MVC or module-per-domain, fat controller or action object,
generated artefacts or none — must produce an identical number. That is the
project's golden invariant, and it is a test
(`tests/acceptance/golden_invariant.spec.ts`) that was written before the first
collector.

**Extensibility as a requirement.** AdonisJS imposes no code organisation — fat
controller, action object, static service, injected service, module function,
job. Tracing strategies are registrable, so a project with its own convention
registers it (see [Custom code pattern](#custom-code-pattern)).

**Function points are not the only number on the dashboard.** If function points
pay, the team optimises function points: more models, more endpoints, less
reuse. Coupling, instability and density come free from the same inventory, and
are the counterweight.

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
    ignoreEntryPoints: ['prometheus.metrics'],
  },

  retStrategy: 'constant', // or 'composition'
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
`job-dispatch`, `static-service`, `property-service`, `module-function`.

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
- **RET is approximated.** What a user recognises as a logical subgroup is not
  derivable from code. The default pins it at 1; `composition` derives it from
  composition relations.
- **Confirmation and error messages** count 1 DET in a manual count and are
  invisible here — a known systematic divergence of −1 DET per transaction.
  `messageDet: 1` restores it.
- **VAF is not calculated.** The 14 general system characteristics require human
  judgement. AFP fixes VAF = 1, and the unadjusted count is what public
  contracts in Brazil use anyway.
- **The modification factor in `fp:diff` is 1.** AEP grades it from 0.25 to 1.75
  using Effort Complexity, which requires cyclomatic complexity. Counting 1
  overestimates, and the report says so.
- **Only HTTP routes are collected as entry points.** An ace command that
  imports a spreadsheet and a scheduled job are transactional functions under
  IFPUG; they are out of v1.

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

- [`docs/design/architecture.md`](docs/design/architecture.md) — the thesis, the
  layers, and what is discovered instead of configured
- [`docs/design/counting-decisions.md`](docs/design/counting-decisions.md) —
  each edge case, with the AFP rule that settles it
- [`docs/design/resolvers.md`](docs/design/resolvers.md) — the catalogue of code
  patterns and how each is followed

Three further documents are kept as a **dated record** of how the design was
arrived at, in Portuguese, and are not a reference for current behaviour:
[`implementation-plan.md`](docs/design/implementation-plan.md) (built phase by
phase, and what each phase found),
[`adonisjs-variation.md`](docs/research/adonisjs-variation.md) (what varies
between real AdonisJS applications) and
[`external-validation.md`](docs/research/external-validation.md) (the thesis
tested outside the sample that produced it).

## Contributing

```bash
pnpm install
pnpm test              # lint + 242 tests, from source
pnpm run typecheck
pnpm run compile && pnpm run test:package   # the packed tarball, installed and used
```

`test:package` is separate on purpose: the suite runs from source through
ts-exec and never loads `build/`, which is the only thing a user gets. A
release once had every `exports` path pointing at a file the build did not
emit, with the whole suite green.

Two house rules worth knowing before opening a PR:

1. **Example first.** A fixture with a known answer comes before the code. A
   fixture written after the code tests what the code does, not what it should
   do.
2. **A silent drop is the worst possible defect.** Anything the tracer cannot
   follow must land in `unresolved` with the _right_ reason, never be quietly
   treated as a read.

## License

MIT
