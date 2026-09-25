# Changelog

Counting rules carry their own version, separate from the package version, and
`fp:diff` **refuses** to compare counts produced by different rule sets. When a
release moves the number for unchanged code, the rule set version moves with it —
otherwise the difference would measure the tool's change rather than the work, and
that difference becomes an invoice.

## Unreleased

**Rule set `afp@1.4.0`.** Two classification defects are fixed and both move numbers,
so a 0.4.0 baseline has to be recounted.

Found by auditing a production count function by function against the code, rather than
by reading the report's warnings — which is where the previous rounds had been looking.

### Fixed

- **Maintenance was decided per REQUEST instead of per store.** `behavior.writes`
  decides EI against EO and was also read as "this store is maintained", so every store
  a writing transaction touched became an ILF. A reference table merely READ by a route
  that writes something else counted as maintained. On a production application this
  left exactly one EIF in the whole count, which should have been the signal.
- **Seeders, tests and factories counted as maintenance.** The project-wide pass read a
  seeder's inserts as the application maintaining a table, so reference data only the
  seed populates came out as an ILF — which the CPM does not allow. The filter on scan
  roots drops `tests/` and `database/` only at the ROOT, and a domain-module layout puts
  both inside `app/`. It now applies at any depth.
- **The override warning counted floors that were already answered**, said "one schema"
  whatever it was given, and therefore fired on a configuration that was complete.
- **`opaqueReviewed` matching nothing was silent.** `detFromSchema` already warns when
  it names a schema that is not declared; a review naming a field that does not exist
  reviewed nothing while the warning kept firing, which reads as the tool ignoring the
  configuration.
- **A review was invisible in `fp:explain`.** Its reason appeared nowhere, which defeats
  requiring one. Reviewed floors are now marked `(opaque, reviewed)` and the reason is
  printed — without being counted in the "Declared by override" share, since a review
  declares no number.

### New

- **`CallResolver.technicalWrite()`** declares that a write is not what the transaction
  is for. §6.5.3 reads any write as an EI, which misreads a screen that records the
  visit; the CPM asks about primary intent. The fact is declared about the CALL, so a
  bookkeeping helper called from several screens is declared once. It does not hide the
  write: the store stays an ILF and stays an FTR.
- **`boundary.business` says when it contradicts the code.** It accepted without comment
  a table nothing in the application writes — which is how two read-only lookup tables
  were declared as business data on the belief they had a CRUD, when the routes were
  `.only(['index', 'show'])`. The declaration is still honoured; the fact is reported.

## 0.4.0

**Rule set `afp@1.3.0`.** Conditional validator groups now count, and a nested
schema is recognised however the formatter wrapped it — so a 0.3.0 baseline has to
be recounted.

Five items reported from real use of 0.3.0, three of them defects.

### Fixed

- **A newline decided whether a field counted.** The recogniser for a nested schema
  was a regex over the property's source text (`/vine\.object/`), and Prettier breaks
  a long chain across lines — `data: vine` then `.object({})` — so the regex missed
  and the field was counted as one leaf instead of its nested ones, and never marked
  opaque. Decided by structure now: is this literal the argument of a call named
  `object`? The same applied to `.merge(…)` and `group.if(…)`, which had the same
  kind of check. A count that depends on where the formatter put a newline is not a
  measurement — the reason the implementation-scope hash strips whitespace before
  hashing.
- **The list of unreadable DETs ignored the overrides that answered it.** It was
  computed before `applyOverrides` ran, so a function whose floor `detFromSchema` had
  already replaced still appeared under "this is a FLOOR", telling the reader to map
  something already mapped. It caused a real misreading of a production report, by
  the author of this code. It now runs after the overrides, is grouped by FUNCTION,
  and states per function how many were replaced by an override, how many reviewed,
  and how many are still unanswered — only the last being a request to do anything.
- **Emitted artefacts carried absolute paths.** `CountSource.app` is documented as
  never being one, because that says where the machine keeps its files and travels
  with every artefact sent anywhere — and the rule was applied to that one field. A
  production count carried **858** absolute paths in its traces; an inventory
  carried **2036** across ten fields, including the data-store `id`. Every path that
  leaves is now relative to the application root, and the internal absolute form is
  untouched because that is what ts-morph resolves against.
- **`vine.group` and `.merge()` were not read.**
  `vine.object({}).merge(vine.group([vine.group.if(p, {…})]))` reported the whole
  validator as an open input object: five fields counted as one, and the report said
  they were data when they are in the code. The branches are mutually exclusive at
  runtime and the transaction can carry any of them, so §7.2 counts their union — a
  field two branches share counts once. The group usually lives in an unexported
  constant beside the validator, so the reference is resolved in the validator's own
  file rather than the caller's.
- **`fp:explain` matched by substring even when the exact name existed.** Asking
  about `POST /orders/:param/submit` returned four functions, because
  `/submit-ready` and `/submit-ready/return` contain it. An exact name now wins
  outright; the substring search is the fallback.

### New

- **`detFromSchema` accepts a list**, unioned by leaf path. An ILF's DETs are the
  fields the user recognises in the file, and an application with one schema per
  template recognises all of them. Pointing at the largest and justifying it in
  `reason` gives the same answer only while they land in the same band — reasoning
  the configuration should not have to carry.
- **`overrides.<fn>.opaqueReviewed`** records that someone looked at an opaque DET
  and decided 1 is right. 1 DET is a floor and `fp:count` says so on every run, but
  some of those columns really are one field, and a warning that cannot be answered
  is one the team learns to scroll past. It moves no number, it is not counted as a
  declared override in the "Declared by override" share, and the volume reviewed is
  still printed.

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
