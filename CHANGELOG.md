# Changelog

Counting rules carry their own version, separate from the package version, and
`fp:diff` **refuses** to compare counts produced by different rule sets. When a
release moves the number for unchanged code, the rule set version moves with it —
otherwise the difference would measure the tool's change rather than the work, and
that difference becomes an invoice.

## 0.3.0

**Rule set `afp@1.2.0`.** Three counting fixes move the number for unchanged code,
so a 0.2.0 baseline has to be recounted.

All four were found by installing 0.2.0 in a production application, which is the
only way any of them could have been found.

### Fixed

- **An open input object counted zero.** `vine.object({}).allowUnknownProperties()`
  declares a field whose own fields live in data; the leaf walk descended into the
  empty literal, found nothing, and never pushed the field either. An opaque JSON
  column in the identical position counts 1. It now counts 1 too, and is reported —
  the opaque-column warning names stores, and this side had no warning at all, which
  is why the route saving the application's main document had never looked wrong.
- **`detFromSchema` was off by one.** It replaced the opaque placeholder by
  subtracting 1 on faith. With no placeholder to replace — the case above — the
  subtraction removed a field the analysis had read correctly. Opaque DETs are now
  marked `(opaque)` in the rationale, and the override replaces a marked one or
  none, warning when it finds nothing to stand in for.
- **A schema declared in a seeder was not found.** `database/` is excluded from the
  application roots so a test factory's writes never become counted functions, but
  `make:seeder` puts seeders there. Naming such a schema reported "not declared
  anywhere in the code" and left the count at the floor — the exact case the
  override exists for. The schema catalogue now reads `database/` as well; the call
  graph still does not.
- **`@adonisjs/queue` names the execution method `execute`**, which the list of
  names did not have. It surfaced only once event dispatch started being followed:
  the listener was what enqueued the job, so that path had never been walked. Third
  name this list has learned by measurement — a list written from imagination would
  have missed this one too.
- **A write through a relation did not maintain the related table.**
  `distribution.related('files').create({…})` is ordinary Lucid and the relation is
  the subject of the write. Every relation access was treated as a read, so a table
  written exclusively that way came out as an EIF. `preload` and `load` still only
  read, because they hand back the parent.

### New

- `analyze`, `diffCounts`, `measureStructure`, `measureConformance`, `calibrate`,
  `RULESET_VERSION` and the diff types are exported. The two front-ends were the
  only way to reach any of this, so anything built on top had to shell out to the
  CLI and parse its output.

## 0.2.0

**Rule set `afp@1.1.0`.** A baseline saved with 0.1.0 cannot be compared against
this release: recount it, or `fp:diff` will refuse. That refusal is the feature.

### Counting

- **ILF vs EIF is decided across the whole project, not from HTTP routes.** AFP
  §6.5.4 asks who _maintains_ a store; reading that off a walk from routes
  answered a narrower question, so a table written only by a job or a seeder came
  out as somebody else's table. On three production applications this moved 5
  stores out of EIF. A store that is only ever read is still an EIF.
- **A job is followed into its execution method**, which is `handle`,
  `process`, `run` or `perform` depending on the queue package. Looking only for
  `handle` resolved the file, found no body, reported the dispatch as unknown and
  left every write inside it uncounted.
- **An event dispatch is followed into its listeners.** Bindings are read from
  `emitter.on(event, [listeners])`; both generated-registry shapes and the direct
  class reference are handled, as is a binding that names the method.
- **`request.input('x')` and `request.only([…])` count as input DETs.** §7.2 asks
  whether a user-recognisable field crosses the boundary, not how it was declared.
  Deduplicated against validator fields, so nothing is paid for twice.

### Billing

- `fp:diff` factors are reachable from `config/function_points.ts` under `diff`.
  They were a typed extension point only a test could use.
- **`diff.reasonFactors`** prices a modified function by _what_ changed about it:
  `type`, `size`, or `implementation` — same type, same DET, same FTR, different
  body. On a real pair of releases, 151 of 378 FP billed as change were
  implementation only. The default does not move: AEP grades the modification
  factor from 0.25 to 1.75 through Effort Complexity variation, which needs
  cyclomatic complexity this package does not measure, so it stays at 1 and every
  diff says so with the amount at stake.
- The billable total is rounded to cents. `485.00000000000006` is arithmetically
  the same number and not the same document.
- Warnings print **above** the per-function list. On a real diff that list is over
  a hundred lines, and a caveat that has to be scrolled to is not a caveat.

### New

- **`fp:metrics`** — density, coupling (Martin's instability) and conformance,
  from the same inventory as the count. If function points pay, the team optimises
  function points; this is the counterweight. Cycles between modules are reported,
  not scored.
- **`CallResolver.ignores()`** — a third outcome. `resolve` returning `[]` means
  _not recognised_, so a strategy that recognised a call and knew it reached no
  data store had no way to say so. The volume still appears in the confidence
  block: the escape hatch buys coverage, never function points.
- **`boundary.business`** — restores a store the AFP naming filter (§6.5.2.1.3)
  excluded by accident.
- `fp:count` reports transactions that read the request without enumerating
  fields (`all()`, `body()`, `except()`), which sit at the floor of their band.

### Breaking

- `Conformance.writesWithValidator` is now `inputsWithValidator`, and its
  denominator is the transactions that _take_ input rather than every write.
  Measured over every write it read 39% on a healthy application, inviting the
  conclusion that 61% of its writes were unvalidated — they were not: most were
  workflow triggers carrying nothing beyond the route parameter.
- `HandlerBehavior` gained `requestFields` and `opaqueRequest`.
- `ResolverContext` gained `exportedAs` and `eventBindings`.

### Fixed

- An aliased import resolved to the local name, so `import { x as y }` searched
  for `y` in a file that exports `x`.
- A call on the result of a call was reported as unknown even though the inner
  call — where the unknown is — is reported in the same body.
- `X.map(callback)` was claimed by `static-service`, which resolved the module and
  reported a missing `map` in it.
- The package was unusable through ace: `commands/main.ts` exported classes
  instead of the `getMetaData`/`getCommand` contract ace calls, which broke every
  command in the host application.
- `configure` generated `config/function_points.ts` and no command read it.
- Generated-schema detection was disabled on Windows by a path-separator mismatch.

Coverage across four production applications went from 79.7 / 85.9 / 83.5 / 91.4%
to 94.8 / 95.1 / 98.4 / 91.4%.

## 0.1.0

First release. Counts unadjusted function points from AdonisJS 7 + Lucid 22
source, following OMG Automated Function Points 1.0 (ISO/IEC 19515), with
`fp:count`, `fp:inventory`, `fp:explain`, `fp:diff` and `fp:calibrate` in both an
ace and a standalone front-end.

Validated against the case study published in Vazquez, Simões & Albert (2011): 46
FP, exact, with the fixture and the reference count frozen before the counter was
run against them.
