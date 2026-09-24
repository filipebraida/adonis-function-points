# Architecture

Revised after surveying 6 production AdonisJS applications
([`../research/adonisjs-variation.md`](../research/adonisjs-variation.md)). The
earlier version looked for artefacts by folder convention and would have
counted zero in two of the six apps.

## The thesis

**The transaction → data function graph is the backbone of the count.
Everything else is boundary filtering.**

This is not a design preference — it falls out of AFP. Three of the four
boundary decisions in [`counting-decisions.md`](counting-decisions.md) are
settled by the same rule: a static route does not count because it reaches no
data; a third-party package route likewise; a model hook counts because it is
on the path; an orphan table does not count because nobody reaches it.

Practical consequence: the quality of this package is the quality of that
tracing. That is where the effort goes.

## v1 scope: AdonisJS 7 + Lucid 22

The author's decision after the external validation: **v1 targets core 7 with
Lucid 22**. It is not a limitation of the design — the seams are general and
the Kysely fixture stays as a sentinel — it is sequencing: one backend end to
end before the second. Of the 10 applications surveyed, 9 use Lucid.

Outside v1, detected and reported, never counted wrong:

| detected              | behaviour                                                      |
| --------------------- | -------------------------------------------------------------- |
| core 6 / Lucid 21     | "not supported in v1" — no generated schema, no codegen        |
| ORM ≠ Lucid (Kysely…) | "ORM not supported"; the seam is proved by the skipped fixture |
| core 5                | `layout: unknown`, 0 aliases — out of scope                    |

What the v7 scope brings back into play — with the real preconditions, read in
the framework's own source:

| artefact             | how to obtain it                                                                                                                               | precondition                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| routes → handler     | **runtime**: boot the app (`environment: 'web'`, so the route preloads load) and read `router.toJSON()` — exactly what `node ace codegen` does | a bootable app: dependencies installed, env present; **no database**                        |
| `database/schema.ts` | versioned, or `node ace schema:generate`                                                                                                       | the generator **introspects the live database** — with no connection it has to be versioned |
| input DETs           | validator by AST; Tuyau registry when present                                                                                                  | —                                                                                           |
| call graph           | AST                                                                                                                                            | —                                                                                           |

## Source order

**Revised after the external validation**
([`../research/external-validation.md`](../research/external-validation.md)):
the original order ("generated first") only holds for AdonisJS 7 + Lucid 22 +
Tuyau. The official starter kits are on core 6.18 / Lucid 21.6, with none of
the generated artefacts.

Within the v7 scope, per fact:

| fact                    | primary source                            | fallback                                     | reliability                                     |
| ----------------------- | ----------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| routes, verbs, handler  | **AST** of the files listed in `preloads` | —                                            | heuristic, validated against the Tuyau registry |
| data functions, columns | **`database/schema.ts`** (Lucid 22)       | model by AST following the inheritance chain | canonical / heuristic                           |
| input DETs              | validator by AST                          | —                                            | good                                            |
| graph, writes, FTR      | **AST**                                   | —                                            | controlled heuristic                            |
| grouping                | folder convention                         | —                                            | metadata                                        |

> **Not in v1.** Reading the routes from the runtime (`router.toJSON()` after a
> database-free boot) and cross-checking the input DETs against the Tuyau
> registry. Both are decided and recorded here because they shape the source
> order; neither is implemented. Core 7 proves a database-free boot is the
> framework's own pattern (`codegen` does it). No runtime for data, ever:
> `schema:generate` needs the database, so the versioned file is the source.

The report says **which source produced each fact**. A count made purely from
the AST and one made with the generated schema are not equivalent, and the
number has to carry that provenance.

**Folder convention is never used to find anything.** A package that looks for
models in `app/**/models/` counts zero in one of the surveyed apps, where 35
model files do not extend Lucid's `BaseModel` — which is why the AST model
parser has to **follow the inheritance chain** (`extends compose(Base, Mixin)`)
rather than look at the file alone.

### The generated artefacts, and who generates them

| artefact                                                                      | generator                                                                  | since    |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| `database/schema.ts` — `*Schema` with a canonical `$columns`                  | official `@adonisjs/lucid`, `migration:run` (default) or `schema:generate` | Lucid 22 |
| `.adonisjs/server/controllers.ts`, `routes.d.ts` (name + params, **no body**) | `@adonisjs/core` `codegen`                                                 | core 7   |
| `.adonisjs/client/registry/schema.d.ts` — routes **with body/query types**    | `@tuyau/core`, third-party, optional                                       | —        |

When present, they settle two expensive variations on their own: heterogeneous
model styles, and columns that **packages** add through their own migrations.

### Lucid is not a given

`romainlanz.com` (core team) uses **Kysely + kysely-codegen**, without Lucid:
the generated schema is `types/db.ts` (`interface Articles { … }` per table),
the migrations use Kysely's DSL, and writes are
`.insertInto()/.updateTable()/.deleteFrom()`.

v1 supports **Lucid only**: Kysely is detected and reported as unsupported,
with the sentinel fixture skipped in its place. The seam for a second ORM
exists — persistence detection is isolated in `src/inventory/detectors/` — but
it is not a public extension point yet, because nothing in the pipeline
consumes a registered detector. See "Extensibility".

### The scan root is not `app/`

In one application the repositories — where all of the writes live — sit under
`src/<module>/repositories/`, outside `app/`. The scan root is **the set of
directories reachable through the `package.json` aliases** (`app/`, `src/`,
`shared/`, `types/`…), and modules can be nested (`app/admin/taxonomies/`).
`moduleOf()` returns the full module path, not the first segment.

## Layers

```
src/inventory/   raw facts — knows NOTHING about FPA
src/albrecht/    IFPUG/AFP rules over the inventory
```

**Non-negotiable rule:** `src/inventory/**` never imports from
`src/albrecht/**`. The inventory does not know what an ILF is. That is what
would allow the layer to be extracted into its own package if the statistical
metrics grow.

```
src/
├── types.ts                  shared domain model
├── pipeline.ts               analyze(root, options) -> { inventory, count }
├── define_config.ts          FunctionPointsConfig
├── inventory/
│   ├── app_context.ts        discovers the app: package.json imports,
│   │                         generated artefacts, layout, scan roots
│   ├── sources/              facts, per ARTEFACT (not per folder)
│   │   ├── data_stores.ts        models following the inheritance chain;
│   │   │                         the generated schema when present
│   │   └── routes_ast.ts         routes from the preloads, lazy import or map
│   ├── graph/
│   │   └── call_graph.ts     transaction -> data, at METHOD level;
│   │                         input DETs from the validators; coverage
│   ├── resolvers/            how to follow each code pattern
│   └── detectors/lucid.ts    what is a read and what is a write
├── albrecht/
│   ├── tables.ts             IFPUG complexity tables
│   ├── data_functions.ts     ILF vs EIF, DET/RET
│   ├── transactional_functions.ts   EI vs EO, DET/FTR
│   ├── technical_filter.ts   AFP 6.5.2.1.1 + origin of the write
│   ├── counter.ts            the count
│   ├── diff.ts               additions / modifications / deletions (AEP)
│   └── calibration.ts        bias against a manual count
├── metrics/structure.ts      coupling, density, conformance
└── reporters/table.ts        the `fp:*` reports
```

## Two front-ends, one set of runners

The package is used two ways: installed, through `node ace fp:*`, and
standalone, through `npx` in CI. Neither can be allowed to disagree about a
number, so everything that decides one lives in `src/cli/runners.ts` and both
front-ends only parse arguments and print.

```
commands/fp_*.ts   ace adapters (@adonisjs/core)  ─┐
                                                   ├─> src/cli/runners.ts ──> analyze()
bin/cli.js -> src/cli.ts   standalone, for CI     ─┘
```

Standalone is possible at all because of a decision taken in Phase 1 for a
different reason: **fixtures do not boot**, so the engine had to work from the
AST over a file tree. `src/**` imports nothing from `@adonisjs/*`, needs no
container, no `.env` and no database. The framework is a peer dependency of the
ace adapters only.

Loading `config/function_points.ts` belongs to the shared layer for the same
reason. The ace commands run with `startApp: false`, so there is no booted
container to read configuration from, and the standalone CLI has no container
at all — both import the file directly.

## Discovery in place of configuration

`AppContext` discovers what it needs rather than asking:

- **`#` aliases** — read from `imports` in package.json, never deduced: two
  incompatible conventions are in use (`#models/*` by type, `#collect/*` by
  module);
- **generated artefacts** — located by the generation header and the shape of
  the classes, not by path;
- **layout** — detected, and used only to group the report.

What remains as configuration is only what is a **business decision** no
heuristic should make: the application boundary, which stores are maintained
externally (EIF), and overrides with a mandatory justification.

## Extensibility is a requirement

AdonisJS imposes no organisation. Measured across the 6 applications, writes
are spread like this:

| app | controllers | services | actions | queries | jobs | models |
| --- | ----------- | -------- | ------- | ------- | ---- | ------ |
| A   | 0           | 3        | 15      | 0       | 0    | 3      |
| B   | 14          | 16       | 92      | 0       | 0    | 0      |
| C   | 27          | 154      | 131     | 8       | 63   | 5      |
| D   | 0           | 1        | 135     | 0       | 1    | 1      |

None uses fewer than 4 artefact kinds. Tracing cannot privilege any of them —
it follows the graph wherever it goes, and the artefact kind is only metadata.

**One** public extension point, in `src/inventory/resolvers/types.ts`:

- **`CallResolver`** — how to follow from a call site to the next body. It
  includes resolution **by constructor parameter type** (`@inject()` with
  `constructor(private q: GetArticleQuery)`), which in applications using DI is
  the _only_ path from the route to the write.

User strategies run **before** the built-in ones. **The first to claim a call
wins** — syntactically identical shapes carry different meanings
(`Job.dispatch(p)`, `Service.create(p)` and `Model.find(p)` are all
`Identifier.method(args)`), and only the order separates them.

Store collection, entry point collection and persistence detection remain
**internal seams** — each lives in its own module and can become an extension
point when there is a second real case. While the pipeline does not consume a
registered one, the interface is not exported: a public type the code does not
honour is the same empty promise as configuration with no effect.

### A transaction is not a synonym for an HTTP route

An ace command that imports a spreadsheet and a scheduled job that syncs with
an external system are transactional functions under IFPUG. In v1 only HTTP
routes are collected; the entry point collection seam is what opens that path.

## Traceability is a requirement

Every counted function carries a `Rationale`: the rule applied, the origin of
each DET and FTR, the path through the graph, and overrides with a mandatory
justification. It is what `fp:explain` prints. If function points get invoiced,
someone will dispute a number, and a number without provenance is indefensible.

The ruleset is versioned and appears in every report: counts are only
comparable if the rules did not change in between.

## Saying "I don't know" beats being wrong in silence

A call no resolver follows enters `unresolved` and counts against coverage.
Below `minCoverage`, the count **fails**.

AFP does not treat this as optional:

> "If the transaction execution depends on code that is unknown or unavailable
> to the automated tool, the code end point shall be cataloged and listed in the
> generated report in order to detect and quantify the missing patterns and
> libraries." — AFP §6.5.3

This matters all the more given the decision about static routes: "reached no
data at all" means _either_ that the route is legitimately static, _or_ that
the tracer failed. The two have to be distinguishable in the report.

## Sibling documents

- [`counting-decisions.md`](counting-decisions.md) — the edge cases, with the
  AFP rule that backs each one
- [`resolvers.md`](resolvers.md) — the catalogue of code patterns
- [`implementation-plan.md`](implementation-plan.md) — the plan, test-driven
  (dated record)
- [`../research/adonisjs-variation.md`](../research/adonisjs-variation.md) —
  what varies between applications and what does not (dated record)
- [`../research/external-validation.md`](../research/external-validation.md) —
  the thesis tested outside its sample (dated record)
