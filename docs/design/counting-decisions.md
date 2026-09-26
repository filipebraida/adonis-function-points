# Counting decisions

The cases static analysis raises, what we decided for each, and the normative
rule that backs it. Source: **OMG Automated Function Points v1.0**
(ISO/IEC 19515), which is what this package implements.

Where AFP and intuition diverge, AFP wins — it is what makes the count
defensible.

---

## 1. A route that reaches no data at all

Example: `router.on('/about').renderInertia('portal/about')` — a static page,
with no handler. It appears in 3 of the 6 applications surveyed.

**Decision: it does not count.**

> "To identify the transaction start and finish, the static code analyzer shall
> assume that the code contains a complete transaction whenever it can show one
> or several code paths from the user interface down to the data entities."
> — AFP §6.5.3

With no path down to a data function there is no transaction to identify. AFP
types transactions "through the detection of the transaction's actions made on
the identified internal data entities" — with no entity touched there is
nothing to classify. IFPUG agrees by another route: an EQ requires retrieving
data from an ILF or EIF.

**The best part of this decision is that it needs no special case.** It is not
a rule about `router.on`; it falls out of "trace down to the data". Any route
that reaches no data drops out, whatever shape it has.

**But it has to appear in the report.** "Reached no data" means two very
different things: the route is legitimately static, or the tracer failed. Both
have to be visible, and AFP requires it:

> "If the transaction execution depends on code that is unknown or unavailable
> to the automated tool, the code end point shall be cataloged and listed in the
> generated report in order to detect and quantify the missing patterns and
> libraries for the specific count process." — AFP §6.5.3

---

## 2. Routes registered by third-party packages

Example: `transmit.registerRoutes(...)`, metrics routes, `drive.fs.serve`.

**Decision: they do not count.**

AFP requires a transaction to cross the application boundary and be recognisable
by the user. An SSE channel and a file server are infrastructure.

In practice **no exclusion list is even needed**: by rule 1 these routes reach
no data function of the application and drop out on their own. The list in
`boundary.ignoreEntryPoints` stays as a safety net, and to make the intent
explicit in the report — not as the primary mechanism.

---

## 3. Writes inside a model hook (`@afterCreate`, `@beforeSave`…)

Present in 4 of the 6 applications surveyed.

**Decision: the hook belongs to the transaction that fired it. It is never a
transaction of its own.**

An elementary process is, under IFPUG, "the smallest unit of activity which is
meaningful to the user, that constitutes a complete transaction, it is
self-contained and leaves the business of the application in a consistent
state" — and it must **cross the boundary**. A hook crosses no boundary: it
fires inside a transaction that already crossed one.

AFP requires aggregating everything the transaction reaches:

> "Each transaction shall be traced using static code analysis in order to
> capture all the data functions involved, the DETs involved, and the actions
> performed by the transaction on these data functions. When the static code
> analyzer finds multiple optional paths in the context of a transaction, it
> shall consider these multiple optional paths to be part of the same
> transaction in order to capture all data functions handled." — AFP §6.5.3

**Implementation consequence, and not a small one:** when the call graph
reaches a write on a model, the tracer has to **step into that model's hooks**
too, because they are part of the same path. A write in a hook counts as an
access of the transaction that fired it, adds an FTR, and makes the target
table an ILF maintained by the application.

Ignoring hooks undercounts FTR and can leave a table classified as an EIF when
it is really an ILF.

### Which accesses fire a hook

Implementing this surfaced a distinction the rule alone does not state. Lucid
fires instance hooks for `document.delete()` and does NOT fire them for
`Document.query().where(…).delete()` — a bulk operation changes rows without
instantiating a model. Both land on the same method name.

Following hooks for the bulk form would invent an FTR, and **counting more than
is there is worse than counting less**: an invented FTR moves a complexity band
and goes onto an invoice. The signal used is a call anywhere in the receiver
chain, which errs towards not following — `(await Document.find(id))!.delete()`
is read as bulk. `truncate`, `increment`, `decrement` and the pivot operations
fire nothing either.

A second consequence, and this one favours the rule: `save()` fires the save
pair AND the create-or-update pair, and which of the two runs is not knowable
statically. Following both is not a compromise — AFP §6.5.3 requires treating
multiple optional paths as part of the same transaction.

---

## 4. Mixins and packages that change the model

Example: `class User extends compose(UserSchema, Auditable)`.

**Decision: the tool discovers it; there is no list of known packages.**

This is the right rule because any package can change the shape of a model.
Today it is `Auditable`; tomorrow soft-delete (adding `deletedAt`),
multi-tenancy (adding `tenantId`), versioning. A list of exceptions would be
out of date the following week.

### Columns: the generated schema already settles it

`database/schema.ts` is generated from the migrations, so it reflects the
columns that **actually exist in the database** — regardless of who created
them. A mixin that adds a column through its own migration shows up there; a
transient property does not, and correctly so.

Verified against `@filipebraida/adonis-auditing`: the `Auditable` mixin
declares no `@column` at all. What it adds is behaviour (`$isAuditDisabled`,
`auditComment`, methods) and the data goes to a separate table, created by the
package's own migration. Zero DETs added to the host model — and the generated
schema reaches that conclusion on its own, without the package knowing what
auditing is.

### Package tables: the technical data filter

The remaining problem is the inverse: the `audits` table **does exist** and
would show up as an ILF. AFP anticipates this:

> "Some data tables, namely temporary data tables and technical data tables, are
> ignored in the sizing process in order to match the automated counting process
> with IFPUG rules. Database tables identified as temporary or technical shall
> be marked as such to be presented in the final report, and shall be ignored in
> the rest of this process." — AFP §6.5.2.1.1

AFP offers two mechanisms, and we add a third, better one:

1. **Lookup structure** (§6.5.2.1.2): one PK, at most one ordering integer, no
   cascade-delete relation pointing at it, fewer than three text attributes, or
   names matching `name|message|type|code|description|label`.
2. **Naming convention** (§6.5.2.1.3), configurable, with the spec's own
   defaults: `^(.+temp|.*session.*|.*error.*|.*search.*|.*login.*|.*logon.*|.*filter.*)$`,
   `^(.+status)$`, `^(lkp_.+|.+types?|.+_t)$`.
3. **Origin of the write** — ours: if **every** write to a table originates
   inside package code (`node_modules`) and none originates in application
   code, the table is that package's infrastructure, not a function of the
   application.

The third is what really answers "the tool has to discover it": it depends on
no name, no list, and works for a package nobody anticipated.

> **What is implemented is mechanism 2, and only 2.** The `node_modules`
> boundary that makes mechanism 3 possible is decided but not built. Mechanism 1
> was evaluated and **rejected**: on a real application its "fewer than three
> text attributes" test would have excluded `Instituto` — five columns, an admin
> CRUD, a legitimate ILF. A structural heuristic that moves the number the wrong
> way is worse than none.
>
> The naming list is the spec's, plus one the framework asks for: `.*tokens?.*`
> — `auth_access_tokens`, `remember_me_tokens`, `password_reset_tokens` are the
> machinery of authentication, and came out as ILFs at 7 PF each on two
> applications. `boundary.technicalPatterns` replaces the list, as §6.5.2.1.3
> intends for user input; `boundary.business` restores one table.

### AFP's closing rule

And there is a normative safety net above all of them:

> "If a Data Function is not used in any of the processing of an application's
> Transactional Functions, the Data Function shall not be counted in the
> application." — AFP §6.5.4

A table no transaction of the application touches simply does not enter. That
alone eliminates a good share of infrastructure tables, with no rule at all.

---

## Consolidating: what these decisions have in common

Three of the four are settled by the **same** rule — trace the transaction down
to the data functions and count what it reaches. A static route drops out
because it reaches nothing; a third-party route drops out because it reaches
nothing; a hook is included because it is on the path; an orphan table drops
out because nobody reaches it.

That is a good sign the design is on the right axis: **the transaction → data
graph is the backbone of the count**, and the rest is boundary filtering.

It also confirms the priority: the quality of this package is the quality of
that tracing. That is where the effort has to go.

---

## 5. Identity of a function across versions (`fp:diff`)

This is the decision that touches money: under a demand-based contract, what
gets invoiced is additions / modifications / deletions between two versions. If
a renamed route reads as "deletion + addition" it bills twice; if a real
modification passes as "unchanged" it does not bill at all. Identity
**constrains the shape of the inventory** from the collectors onward, which is
why it was decided before the diff existed.

**Normative basis: OMG Automated Enhancement Points 1.0** — AFP's sibling spec,
built precisely to measure maintenance between two revisions.

> "Each Artifact shall be analyzed in both revisions to determine whether it is:
> Added — when it exists in revision ToRevision while it didn't exist in
> FromRevision. […] Modified — when it exists in both revisions but whose source
> code changed between revision FromRevision and ToRevision." — AEP §6.3

> "A modified transaction exists when one or more of the computational objects
> in its Implementation Scope is modified, added to the processing flow, or
> removed from the processing flow. Computational object modification status is
> based on their source code checksum." — AEP §6.5

AEP also defines _split_ and _merge_ of data entities (by the DETs migrating
from one to another) and _type change_ (ILF ↔ EIF), and weights each case by a
**Complexity Factor**: added = 1; deleted = 0.4; modified between 0.25 and 1.75
per Table 6.1, capped at 0.25–0.75 when what changed is a shared artefact.

### Decision

**Transactional function identity = entry point identity**, never the
implementation:

| kind                     | key                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP                     | `(verb, normalised pattern)` — parameters anonymised (`/books/:id` ≡ `/books/:uuid`), group prefixes applied, trailing slash removed |
| ace command              | `commandName`                                                                                                                        |
| scheduled job / listener | class name                                                                                                                           |

It is **not** the route name (`.as()` is optional and cosmetic — renaming does
not change the function the user sees) nor the controller path (that is
implementation: moving `books_controller.ts` between modules does not alter the
function).

**Data function identity = the physical table name.** It is what AFP derives
the data function from.

**Modification = a change in the checksum of the implementation scope**, as in
AEP, with one deliberate refinement: the checksum is over the **normalised AST**
of the bodies reached (no whitespace, no comments), not over the file bytes.
Running Prettier must not become an invoice.

**A URL rename** is a user-visible change and counts as deletion + addition.

**Factors per change type** are configurable, with AEP as the default. The SISP
metrics guide uses its own factors for addition/modification/deletion; it goes
in as a named _preset_, with the values checked against the revision of the
guide in force in the contract — not from memory.

> **Not in v1.** Split/merge detection between data entities, the `possible
rename` marker for a deleted function with an identical implementation scope,
> and the graded modification factor (AEP Table 6.1, which needs cyclomatic
> complexity). A modification is billed at 1 today, and the report says that
> overestimates.

### How change is priced today

AEP §6.5 gives explicit anchors for added (1) and deleted (0.4). For a **modified**
function it grades the factor from 0.25 to 1.75 through Effort Complexity
variation, which needs cyclomatic complexity this package does not measure — so it
defaults to 1, which overestimates, and every diff says so with the amount at
stake.

What the default leaves on the table is a distinction the tool already measures:

```
changed      87 functions   378 FP  × 1
  type              4 functions    23 FP
  size             38 functions   204 FP
  implementation   45 functions   151 FP
```

`implementation` means same type, same DET, same FTR, different body — a refactor.
On a real pair of releases that was 151 of 378 FP billed as change. Pricing it at
full functional value is not defensible, and pricing it at a number this package
invented would be worse, so the number comes from the contract:

```ts
export default defineConfig({
  diff: {
    preset: 'sisp', // Roteiro de Métricas do SISP: 1,00 / 0,50 / 0,30 — the default is `aep`
    reasonFactors: { implementation: 0.25 },
  },
})
```

### What the inventory therefore carries

- `EntryPoint.identity`: the key above, computed at collection time
- `Behavior.scope`: the list of `{ file, member, bodyHash }` reached
- `DataStore.table` and the DET names

---

## 6. Output DETs (EO / EQ)

With Inertia, what goes out is `inertia.render('page', props)`. The whole
serialised model? Only what the screen shows? Only the transformer? Without a
decision, every EO has an invented DET count.

**Normative basis: AFP counts a transaction's DETs by the data fields used, not
by what is rendered.**

> "A data function shall be identified as used if any of its tables or table
> fields are used. Each data function (ILF or EIF) shall be identified as a File
> Type Referenced (FTR) and each table field shall be identified a Data Element
> Type (DET). […] Count only one DET for each unique field that is required to
> complete the Output Transaction. If a DET both enters and exits the boundary,
> count that DET only once." — AFP §7.3

And AFP is explicit about the priority when this diverges from a human counter:

> "This specification prioritizes repeatability and consistency over consistency
> with the IFPUG CPM counting guidelines." — AFP §6.1

### Decision

The DETs of an EO are **what the code shows leaving the boundary**, read in this
order of precedence — the first that is visible decides:

| what the code does                                                                                                                | DETs                                                                                                                                                                                                                                                           | rationale prefix |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| passes through a transformer (`X.transform(...)`, `new X(r).method()`)                                                            | **the keys the method returns**, for the store the transformer is FOR (`BaseTransformer<X>`, and the nested ones' resources); a covered store's columns are NOT added on top. A store read beside it and passed raw is not covered and falls to the rows below | `transformer:`   |
| a nested transformer inside the literal                                                                                           | its own keys, once; the key holding it is not a DET                                                                                                                                                                                                            | `transformer:`   |
| `...this.pick(this.resource, [...])`                                                                                              | the listed names                                                                                                                                                                                                                                               | `transformer:`   |
| `...this.toObject()`                                                                                                              | nothing here — the followed body contributes                                                                                                                                                                                                                   |                  |
| `xs.map((x) => x.nome)`                                                                                                           | 1 — a repeating group of one attribute                                                                                                                                                                                                                         | `transformer:`   |
| `xs.map((x) => ({ a, b }))`                                                                                                       | the leaves, once                                                                                                                                                                                                                                               | `transformer:`   |
| any other spread (`...this.resource.serialize()`)                                                                                 | **1, opaque, reported** — a floor, like an open `vine.object` (§9)                                                                                                                                                                                             | `transformer:`   |
| the resource's identifier re-emitted (`id`)                                                                                       | 0 — the same reason `isPrimary` is not a DET on the data function                                                                                                                                                                                              |                  |
| a system timestamp (`autoCreate` / `autoUpdate`), however it leaves                                                               | 0 — the framework stamps it; the user neither supplies nor recognises it                                                                                                                                                                                       |                  |
| `.count()`, `.exists()` on a store — an aggregate read                                                                            | **1 DET** for that store, one derived scalar leaving; a dashboard of counters is a handful of DETs, not the tables                                                                                                                                             | `aggregate:`     |
| a relation preloaded on a covered store, and read no other way (`Livro.query().preload('autor')` handed to a `Livro` transformer) | covered too — it was loaded FOR the transformer, which emits whatever of it leaves                                                                                                                                                                             |                  |
| a column declared `serializeAs: null`                                                                                             | 0 on every output — Lucid never serialises it; still a DET of the data function                                                                                                                                                                                |                  |
| no transformer, `.select(['title', 'isbn'])` / `.select('a', 'b')`                                                                | only the columns named, for that store                                                                                                                                                                                                                         | `select:`        |
| no transformer, nothing visible                                                                                                   | every column of every store reached, `.preload()` included                                                                                                                                                                                                     | `output:`        |
| a field that enters and exits (a filter echoed on screen)                                                                         | counted once                                                                                                                                                                                                                                                   |                  |

A `.select()` whose list is not literal is unresolved with its reason, and the
store falls back to every column: overestimating in the open rather than
guessing. A `.select()` inside a `preload` callback narrows nothing yet — it is
on the related store's chain, not this one.

**Measured** on an application with 71 functions when this landed: 16 EOs
changed DET, the total moved −9 FP, and `GET /perfil` went from 45 DET to the 10
keys its three transformers emit. The DETs moved far more than the points did,
which is the granularity effect §7 describes.

The first version made a transformer cover the whole page. Recounting the three
validated applications showed why that is wrong: a questionnaire page at 4 DET
with 5 FTR — the transformer of its header had erased the questions rendered
raw beside it — and a dashboard of eight counters at 5 DET. A transformer says
what leaves for **its** resource; what leaves for the rest is what the code
shows for the rest, and a `.count()` shows one number. The next recount added
two more: an activity log whose `User.password` and `User.verdeToken` were
output DETs — the users had been preloaded for the transformer that names the
actor, and a column Lucid never serialises cannot leave.

**Known and accepted divergence:** a human counter counts the fields
_displayed_; with no transformer and no `.select()` we count the whole table and
overestimate. That is the trade AFP makes on purpose — repeatability over
fidelity — and the origin of each DET is in the `Rationale` (`transformer:`,
`select:`, `output:`), so `fp:calibrate` can measure the bias per origin.

**System timestamps, and where this departs from the letter of AFP.** A column
the framework stamps on insert or update — `@column.dateTime({ autoCreate: true })`,
`autoUpdate: true` — is not a DET: on the data function, on an output read
whole, on a `.select()` that names it, or on a transformer that re-emits it. The
ground is the one `isPrimary` was already excluded on: IFPUG's DET is a _user
recognisable_ attribute, and the user neither supplies nor maintains this one.
The control is a `dateTime` the user sets (`concluidaEm`), which counts — the
rule is about who maintains the column, not its type. AFP §7.2 says "each table
field shall be identified as a DET", which on its letter would count both the
key and the stamps; the package departs from that letter for the key and now,
consistently, for the stamps, and says so here. Not configurable: an option
nobody can defend either way is not a business decision.

**The delivery is the boundary (0.7, plan §A′).** Everything above says what a
store contributes when it leaves; this says _which_ stores leave, and what else
does. The place a transaction's output crosses the boundary is its delivery —
the props handed to `inertia.render` / `inertia.modal` / `view.render`, the
payload of `response.json` / `.ok` / `.created` / `.send`, a literal the handler
returns — and each value delivered is read:

| delivered value                                                                                   | DET                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| a transformer the graph follows                                                                   | its keys (above)                                       |
| the result of a followed call that **returns a literal** (a summary query, a view-model function) | the literal's leaves, once — `render:categorias.total` |
| the result of a followed call that returns rows (a query object)                                  | the stores that body reads, by the rules above         |
| a variable bound to a store, or a store access handed straight on                                 | that store's columns, by the rules above               |
| `xs.map((x) => ({ a, b }))` built in the controller                                               | the leaves, once (§7)                                  |
| a scalar, a property, an expression (`total`, `podeEditar`)                                       | **1**                                                  |
| an input echoed back (the validated payload, `request.input(...)`)                                | 0 here — it counted on entry (§7.3)                    |
| a store **read but delivered by nothing** (to authorise, to decide)                               | 0 on the output; still an FTR                          |
| a value nobody can read (`response.send(gerarCsv(rows))`)                                         | 1, `(opaque)`, reported                                |

Without a delivery point the rule cannot apply and every store read leaves, as
before. Measured before it was written: on the three validated applications
the rule moves −8, −2 and +9 FP — derived scalars add where the whole table did
not reach the band, stores read only to authorise stop inflating where it did.
It decides what the number is made of far more than what it is, and that is
what `fp:explain` needs on an output: the DETs named are the ones the screen
received. The measurement also changed the rule: no delivered collection was a
variable bound to a store — they come out of query objects — so a followed
call's **return** is what its value hands on. And the first recount changed it
again, three times: a home page assembling `[destaque, ...rows].slice(0, 4)` had
fallen to 1 DET (an array is its collection); a questionnaire report built by
`montarCsv(linhas, perguntas)` sat at 2 DET with 6 FTR (a document is made of
what was handed into it); and a page whose fields live in `useVariant('x')` came
out at 5 DET with 5 FTR (a variant is a method, and the resolver had followed only
`toObject()`).

The second and third recounts refined how a delivered value is **read back to
its origin**, and each refinement is a row of the render_props fixture:

| shape                                                                                            | reading                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `const { data, meta } = await q.handle()`; `resultado.linhas`; `meta.pagina`                     | one **key** of what the call returns, resolved against the body's return, classified — `data` hands on the rows, `meta.pagina` one value |
| `X.transform(r).useVariant('forEgresso')`                                                        | the variant **replaces** `toObject()`: only its keys leave; following both had doubled a list page to 65 DET                             |
| `function proximos()` / `const f = () =>` in the same file                                       | followed like an import (`local-function`): what it reads is an FTR, what it returns is delivered                                        |
| `rows.map(paraLinha)` — a function by reference                                                  | a call to that function over the rows: its literal, once. A home page mapping this way had fallen to 1 DET                               |
| `q ?? null`, `page \|\| 1`, `startDate?.toISOString()`                                           | the input, with a default or formatted: still the echo, counted on entry. Every listing page had counted its filters twice               |
| `paginator.getMeta()`                                                                            | `total`, `perPage`, `currentPage`, `lastPage`: four values the page can show; the URLs are navigation, `firstPage` a constant            |
| `{ [STATUS.A]: n, [STATUS.B]: m }`                                                               | a map: **one** repeating attribute (`porStatus.*`), as a `.map()` counts its leaves once (§7). A status board had counted 11             |
| `user.email` on a call nobody followed; `contagem[papel]` on one that was                        | one field, named by its key — not an opaque floor; only a key that carries rows on (`data`, `rows`, `items`) stays unreadable            |
| `bouncer.with(P).allows('create')`, `x.toISODate()`, `i18n.t()`, `env.get()`, `Object.values(E)` | a yes/no, a value formatted, a framework service's answer, a constant list: one value                                                    |
| `inertia.defer(() => q.handle())`, `.scroll`, `.lazy`, `.optional`, `.merge`                     | the callback's value: what leaves, later                                                                                                 |
| `rows.map(f).join('\n')` in a body whose parameter is `rows`                                     | the whole input transformed: says nothing on its own, so the caller's arguments decide (the CSV rule above)                              |

What stays **opaque** after this, on the three applications, is what nobody can
read statically: `Map.get()`, a `reduce` into an object, a package's health check,
an external API's answer. It is reported by transaction, as a floor.

**Error and confirmation messages:** the IFPUG manual counts +1 DET; AFP does
not. We follow AFP. The Ligeiro study showed this is the systematic −1 DET per
transaction divergence; it stays as `messageDet: 0 | 1` in the configuration,
for calibration, defaulting to 0.

---

## 7. DETs for composite types (input)

VineJS validators and registry types have nested objects, arrays, unions and
spreads. The spike used "+3 for a spread" — a guess, and guessing is what this
package exists to eliminate.

**Normative basis:**

> "A data element type is a unique user recognizable, non-repeated attribute
> that is part of an ILF, EIF, EI or EO." — AFP §4, citing ISO/IEC 20926
>
> "Count only one DET for each unique field that is required to complete the
> External Input." — AFP §7.3

Plus the IFPUG rule for a repeating group: a recursive DET counts only on its
first occurrence.

### Decision

| shape in the validator / type       | DETs                               | why                                                                             |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| scalar field                        | 1                                  | a unique attribute                                                              |
| nested `vine.object({ a, b })`      | leaves counted individually        | the user fills in each one                                                      |
| `vine.array(vine.string())`         | 1                                  | repeating group of one attribute                                                |
| `vine.array(vine.object({ a, b }))` | the object's leaves, **once**      | a repeating group counts on its first occurrence                                |
| `vine.enum(...)` / union            | 1                                  | one attribute with a domain                                                     |
| `.optional()` / `.nullable()`       | 1                                  | the field exists                                                                |
| route parameter (`:id`)             | 1 each                             | input required to complete                                                      |
| file upload                         | 1                                  | one attribute                                                                   |
| `...base.getProperties()` (spread)  | the leaves of `base`, **resolved** | if it does not resolve, it counts **0 and enters `unresolved`** — never a guess |
| a field that enters and exits       | 1                                  | AFP §7.3                                                                        |
| the submit button / command         | 0                                  | the IFPUG manual counts 1; AFP does not                                         |

> **Not in v1.** Cross-checking against the Tuyau registry, whose `body` is the
> same tree already resolved (spreads included) and should prevail over the
> validator AST. The two sources must produce the same number.

---

## 8. Schema-driven applications

Some applications store what the user fills in as data rather than as code. A
form definition lives in a JSON column, the filled document lives in another,
and the fields the user recognises exist only as rows in the database:

```ts
@column() declare definition: object          // a JSON Schema describing a form
@column() declare filled: Record<string, any> // the document the user filled in
```

**Decision: each opaque column counts as 1 DET, and the divergence is recorded
rather than corrected.**

The schema is runtime data. There is no file to parse, no type to read, and no
amount of static analysis reaches it — this is a boundary of the automated
approach, not a gap in the implementation. A human counter would open the form
and count its fields.

AFP chooses this trade explicitly:

> "This specification prioritizes repeatability and consistency over consistency
> with the IFPUG CPM counting guidelines." — AFP §6.1

So the count is wrong in the same direction every time, by an amount that can be
measured, rather than right in a way nobody can reproduce.

### Measured, so the size of the divergence is known

On a production application built this way:

|                          |                                       |
| ------------------------ | ------------------------------------- |
| opaque columns           | 9 of 336                              |
| effect on data functions | **none**                              |
| effect on transactions   | one form submission, ~2% of the total |

**Data functions are immune, and that is arithmetic, not luck.** With RET = 1 —
which is the default strategy, because a logical subgroup is not derivable from
code — the IFPUG grid stays at _low_ up to 50 DETs. A table already counting 44
DETs pays the same 7 points as one counting 4, so fields hidden inside a JSON
column would have to be numerous enough to cross 51 before anything moved.

**Transactions that READ the document are also mostly immune**, for the opposite
reason: they already count _high_, because an output's DETs come from the whole
table read (§6) and these tables are wide.

What is genuinely undercounted is the transaction where the user **submits** the
form: it shows 2 DETs — a route parameter and a payload — where a human counter
would see the form's fields, taking it from low to high complexity.

### What not to do about it

**Do not inflate DETs to compensate.** A guessed field count is not
reproducible, and reproducibility is the only reason this number is defensible.
An estimate applied silently would also break `fp:diff`: the same document would
count differently between two runs for no reason visible in the code.

### What to do instead: declare it

The person who knows the form knows the number. So they state it, in the
versioned configuration, with a justification that is required by the type:

```ts
export default defineConfig({
  opaque: {
    'Survey.answers': {
      schemas: 'surveySchema',
      reason: 'form driven by a JSON Schema; the fields are counted from the schema by §7',
    },
  },
})
```

The key is the **origin** of the opaque DET — a column (`Survey.answers`, or
`surveys.answers` by table) or an open validator field
(`answerSurveyValidator.answers`) — and the declaration applies to every
function that carries it: the ILF, the transaction that submits the form, and
each one that shows the column. See §9, "Declared by origin".

**Name the schema, do not declare the number.** A declared `det: 42` freezes:
someone adds a field, the count does not move, and `fp:diff` reports no change
for real functional growth — undercounting silently and progressively, which is
worse than undercounting once.

Where the schema is a literal in the code — a seeder, typically — it is not
runtime data at all, and ts-morph reads it. The §7 leaf rules apply unchanged;
only the recognition differs, `properties` and `items` in place of `vine.object`
and `vine.array`. The count then rises on its own when a field is added, and the
only thing maintained by hand is the **mapping**, which changes when a form is
born rather than when a field is.

A name matching no schema is a warning and the count is left as found: a renamed
or moved schema breaks the mapping, and counting on silently would reintroduce
the staleness this avoids.

`det` remains for the case where the schema really is only in the database.

That keeps the three properties the count rests on. It is **reproducible**,
because the number lives in a file under version control and the same revision
yields the same total — reading the database would break exactly that, which is
why the count never connects to one. It is **auditable**, because `fp:explain`
prints the declaration beside its reason and marks the DET line as declared. And
the **judgement sits with whoever has the information**, rather than with a
heuristic.

The difference from inflating DETs is not cosmetic: inflating is the tool
guessing in silence; an override is a person declaring with provenance. AFP §6.1
asks for repeatability, and a declared number is perfectly repeatable.

**Used sparingly, and visibly.** An override is right where static analysis is
demonstrably blind, and poison as a habit — if it spreads, the count stops
coming from the code and the tool loses its reason to exist. So `fp:count`
reports how many functions were declared and what share of the total they carry,
and an override naming no function is a warning rather than silence.

The other two honest routes remain: calibrate — `fp:calibrate` against a manual
count measures exactly this bias, per function type — or price schema-driven
work by another rule in the contract. Both are decisions for whoever signs it.

### A related finding, and not the same thing

The same application shows 53 of 98 input transactions with exactly 1 DET, which
looks like the same problem and mostly is not. Their names are `approve`,
`clear`, `mark-ready`, `transfer` — workflow triggers that legitimately carry no
input beyond the route parameter. A workflow-heavy application really does have
many small transactions, and counting them small is correct.

Distinguishing the two matters: the first is a known limitation to calibrate,
the second is the measurement working.

## 9. Who maintains a store, and who runs the code

Three decisions from the same root: the graph is walked from HTTP entry points,
and some questions are not about entry points at all.

### Maintenance is a property of the application, not of its routes

AFP §6.5.4 separates an ILF from an EIF by asking who **maintains** the store.
Reading that off the walk from routes answered a narrower question — _does a
request write here?_ — so a table written only by a job, a scheduler or a seeder
came back as somebody else's table. That both undercounts (an EIF is worth less
than an ILF) and misdescribes the system, which is worse: the EIF list is what
an audit reads as "these are the integrations".

**Decision.** Maintenance is decided over the whole project: a write anywhere in
the application's own source makes the store an ILF. What is _counted_ still
comes from entry points alone — a job nobody dispatches is not an elementary
process, and inventing one would be the opposite mistake.

On three production applications this moved 5 stores out of EIF, and what
remained is legible: in one of them the 4 surviving EIFs are exactly the tables
mirrored from an external registry. The check that keeps this from collapsing
into "everything is an ILF" is the store that is only ever read — still an EIF,
and a fixture asserts it.

### The execution method of a job has no single name

A dispatch is followed as part of the same transaction: the user clicks and the
effect happens, whatever thread runs it. But `dispatch` belongs to the queue
package's base class, and the method that _runs_ is named `handle` by
`@adonisjs/queue`, `process` by `@nemoventures/adonis-jobs`, and other things
elsewhere.

Looking only for `handle` produced the worst of both outcomes: the file resolved,
no body was found, the dispatch was reported as an unknown, and every write
inside it went uncounted. On one application that was 14 dispatches.

**Decision.** Look for `handle`, `process`, `run`, `perform`, in that order, and
when the class declares none of them keep the dispatch name — so the gap stays
visible instead of being attributed to a body nobody found.

### An event is the same decision as a job

`events.OrderPlaced.dispatch(id)` in a handler is the user's click, and the write
happens in a listener. Same rule: the effect belongs to the transaction that
caused it, and §6.5.3 requires aggregating every path the transaction reaches.

It cannot be followed from the call site alone. `dispatch` comes from
`BaseEvent`, so the event class declares no body, and the binding lives in a
preload file the handler never imports. So the bindings are collected once,
before any handler analysis, exactly like the data stores — and they are **read**
from `emitter.on(event, [listeners])`, never inferred from a name, the same rule
the subpath imports follow.

Both shapes count: the generated registries that `make:event` produces, and the
class imported directly. The second matters more than it looks — `X.dispatch(p)`
is the shape `job-dispatch` matches, so without running first the event resolver
would watch the job strategy resolve the event class, find no `handle`, and
report the dispatch as an unknown.

A binding may name the method (`[[Listener, 'onShipment']]`). Taking `handle` on
faith there looks for a body that is not the one bound.

On one production application this closed the last 4 pending calls and added an
FTR to 3 transactions. **It moved no function points**, and that is worth
recording rather than hiding: the stores were reached, and none of the three
crossed a complexity band. The measurement got more complete without the total
moving — which is the granularity effect §7 already describes, seen from the
other side.

### An input that enumerates nothing is a floor, never a zero

`answers: vine.object({}).allowUnknownProperties()` declares a field whose own
fields live in data. The leaf walk descended into the empty literal, found
nothing, and then never pushed `answers` either — so the field counted **zero**,
while an opaque JSON column in the identical position counts 1. Nothing in the
report said so, because the opaque-column warning names stores and this one is on
the transaction side.

**Decision.** It counts 1 and is reported, exactly as a column is. Zero would make
an unreadable field cheaper than a plain string, which is the wrong direction for a
number that becomes an invoice.

That zero is also what made `detFromSchema` off by one. Its formula replaces the
opaque placeholder with a schema's field count, and it did so by subtracting 1 on
faith. With no placeholder to replace, the subtraction ate a field the analysis had
read correctly. The rationale now marks opaque DETs — `(opaque)` — and the override
replaces a marked one or none, warning when it finds nothing to stand in for.

Found by installing the package in a production application: the route that saves
its main document was not counting the form at all, which is why its EI had never
looked wrong.

### A write through a relation maintains the related table

`distribution.related('files').create({…})` is ordinary Lucid, and the relation is
the **subject** of the write. Every relation access was treated as a read, with a
comment asserting it, so a table written exclusively that way came back as an EIF —
somebody else's table.

**Decision.** `related(…)` followed by a write method writes the relation target;
`preload` and `load` do not, because they hand back the parent and what follows
acts on the parent. The distinction is the API's, not a heuristic: `related` returns
the relation's own query builder.

The control that keeps this honest is a fixture where a model is only ever
preloaded and stays an EIF. Without it, widening this to "any relation access
writes" would pass every other test in the suite.

### Where a form's schema is allowed to live

`database/` is excluded from the application roots on purpose: test factories and
migrations contain real persistence calls, and scanning them would turn a test
write into a counted function.

But `node ace make:seeder` puts seeders in `database/seeders`, which is where seed
data — and therefore a form's schema — normally lives. So a declaration
naming a schema declared in a seeder reported "not declared anywhere in the code"
and left the count at the floor: the exact case the override exists for.

**Decision.** The schema catalogue reads `database/` as well. Reading a literal
counts nothing, so the exclusion still protects what it was for — the call graph —
and only the catalogue is widened.

### Conditional groups count as their union

`vine.object({}).merge(vine.group([vine.group.if(p, {…})]))` declares fields in
branches that are mutually exclusive at runtime. The elementary process can carry
any of them, so §7.2 counts the fields it handles: the **union**, with a field two
branches share counting once.

Read from the first object literal alone, the outer `{}` made the whole validator
look like an open input object — five fields counted as one, and the report said the
fields were data when they are plainly in the code. `detFromSchema` could not
correct it either, because a group is not a JSON Schema.

**Decision.** The union, and the reference in `.merge(x)` is resolved in the
VALIDATOR's file rather than the caller's: the group normally lives in an unexported
constant beside it, so looking where the call site is finds nothing.

### An artefact never says where the machine keeps its files

`CountSource.app` is the manifest name precisely so a count carries no absolute
path. The rule was stated on that field and applied to that field: a production
count carried 858 absolute paths in its traces, and an inventory 2036 across ten
fields, including the data-store `id`.

**Decision.** Every path that LEAVES is relative to the application root. Absolute
is right internally — it is what ts-morph resolves and what the call graph keys its
caches on — so the conversion happens at the boundary, once, and the store `id` is
converted only after the ancestor filter has used it. A path outside the root keeps
its `../` prefix, which says how deep the root is and nothing about where it lives.

### A warning that cannot be answered

An opaque DET counts 1, and `fp:count` reports it on every run because 1 is a floor
rather than a measurement. But some of those columns really are one field — a copy,
a checksum, a bag of metadata — and there was no way to record that someone had
looked. The warning then fires forever, and a warning that cannot be answered is one
the team learns to scroll past. That costs more than the warning reports, and it is
the same failure mode as a coverage gate that fails spuriously.

**Decision.** `opaque.<origin>.reviewed` records the review, with the same
mandatory `reason` every declaration carries. It moves no number; it is deliberately
NOT counted in the "Declared by override" share, because that line exists to show
how much of the total came from a person and a review declares nothing; and the
count of reviewed items is still printed, so the fact is recorded rather than erased.

### Declared by origin, not by function

The two declarations about an opaque DET — the schema that stands in for it,
and the review that says 1 is right — were keyed by the **function** they were
written on (`overrides.<fn>.detFromSchema`, `overrides.<fn>.opaqueReviewed`).
Read from a real configuration, that produced the same mapping written twice
(on the ILF and on the submitting transaction) and a `GET` that returned the
same column still at 1 DET, because nobody had written a third one: **the same
column worth two numbers in one count**.

It also matched reviews by bare field name, because the function side spelled
the column by model and the rationale by table. So reviewing `Attachment.metadata`
reviewed every `metadata` column of every store — and silenced warnings nobody
had answered.

**Decision.** A declaration is about the **origin** of the placeholder, and the
count applies it wherever that origin appears:

```ts
opaque: {
  'Survey.answers':                { schemas: SURVEY_SCHEMAS, reason: '…' }, // a column
  'answerSurveyValidator.answers': { schemas: SURVEY_SCHEMAS, reason: '…' }, // a validator field
  'Attachment.metadata':           { reviewed: true, reason: '…' },
}
```

A column may be keyed by model or by table. Output columns carry the
`(opaque)` marker too, so the declaration reaches the transactions that show
the column and not only the store. The match is exact: reviewing `A.schema`
does not review `B.schema`. `overrides.<fn>.det` / `.refs` remain per function
— a declared _number_ is about one function — and the two old keys are no
longer read; a configuration still carrying them is told so.

### Maintenance is a question about a store, not about a request

`behavior.writes` decides EI against EO — it is a property of the TRANSACTION — and it
was also read as "this store is maintained". Every store a writing transaction touched
became an ILF, so a reference table merely READ by a route that writes something else
was counted as maintained by the application.

On a production application that left **one** EIF in the whole count, which should have
been the signal. §6.5.4 asks who maintains THIS store, which is a question about the
access.

**Decision.** A behaviour carries `writtenStores` beside `touches`, and maintenance is
decided per store. `writes` keeps its own, separate job.

### Seeders, tests and factories do not maintain anything

The project-wide maintenance pass read a seeder's inserts as the application
maintaining a table. The CPM puts data maintained by the development team at an EIF at
most, and code data outside the count altogether — so a reference table only the seed
populates is never an ILF of the application.

The filter on scan roots already drops `tests/`, `database/` and the rest, but only at
the ROOT. An application organised by domain module puts both inside `app/`:

    app/billing/tests/functional/invoice.spec.ts
    app/billing/seeders/plan_seeder.ts

so they were in the project and the root filter never saw them.

**Decision.** The same notion applied at any depth, by the directory names AdonisJS's
own generators use — `tests`, `seeders`, `migrations`, `factories` — plus the
`.spec`/`.test` suffixes its suite globs match.

### A technical write does not decide what a transaction is for

§6.5.3 is mechanical: a transaction that modifies a data store is an EI. That is
deliberate — §6.1 chooses repeatability over CPM fidelity — and it misreads one shape.
A screen that records the visit, the last organisation seen, a view counter: the CPM
asks what the elementary process is PRIMARILY for, and the answer is presentation.

**Decision.** A resolver may declare a call a `technicalWrite`. The fact is about the
CALL, not about each transaction that reaches it, because a bookkeeping helper is called
from several screens and saying it once covers all of them. It is asked of a direct
write too — `Notification.query().…update({ status: 'read' })` in a `show` handler is
the same fact with no method to name.

It does NOT hide the write: the store stays maintained by this application, stays an
ILF, and stays an FTR of the transaction. Only the classification changes. A
declaration meant to make the write disappear would be `ignores`, and would be wrong.

### Three outcomes, where a resolver had two

`resolve` returning `[]` meant _not recognised_. A strategy that recognised a
call perfectly well and knew it reached no data store had no way to say so: the
call stayed unresolved, and the only workaround was to point a resolver at a
body that does not exist.

**Decision.** `CallResolver` gains an optional `ignores()`. It is deliberately
more expensive than a name on a silence list — it costs a named strategy in the
project's own config — because the volume is still reported, and a silent drop
is the worst defect this package can have, whoever writes it.

### What the noise filter refuses before the resolvers run

The rest of the filter is consulted only once every strategy has declined, which
is right: a call worth following should be followed. Iteration is the exception.
`LABELS.map((name) => …)` is `Identifier.method(args)`, the shape
`static-service` exists for, so a resolver claimed it, resolved the enum module,
found no `map` in it and reported a gap — noise never got asked. On one
application that was 30 of its 40 pending calls.

No strategy's pattern is `X.map(callback)`, so refusing that shape up front
costs nothing, and it is not the same as silencing an unresolved call: nothing
was there to resolve. The callback is what does the work — `repo.find(id)` is a
query and `rows.find((r) => …)` is a predicate, so the method name alone still
decides nothing.

## 10. Master-detail: when a table is a RET, not a data function

Every Lucid model was a data function of its own. Under the CPM a detail the
user only ever sees inside its master — the lines of an order, the phone
numbers of a person — is a **RET** of the master's ILF, not an ILF at 7 PF. In
any application with master-detail that overcounts the data half, and the
Vazquez benchmark could not catch it because the case study has no composition.

**The signal that was measured and rejected.** The structural criterion —
`onDelete('CASCADE')` in the migration — is what one would reach for first. On
a real application 11 of 13 cascades pointed at the tenant table: comments,
contacts, questionnaires and requests all cascade with `cursos`, and none of
them is a RET of a course. Cascade is referential hygiene, not composition.

**Decision: usage, the rule the rest of the count already runs on.** The CPM
asks whether the user recognises the group **on its own**. If no application
code addresses a store directly — no `C.query()`, `C.find…()`, `C.create()`,
`new C()` anywhere outside tests, seeders and factories — and it is only ever
reached through a parent's `related()` / `preload()` / `load()`, the user never
sees it outside that parent. §6.5.4 already decides ILF against EIF and what is
counted at all by how the application uses a store; this decides RET the same
way.

A store `C` is a RET of `P` when, and only when:

1. `P` declares `hasMany` / `hasOne` → `C`;
2. no application code addresses `C` directly — a project-wide pass, the same
   one that decides maintenance, with the same exclusions;
3. exactly one `P` satisfies (1). With two or more, `C` stays its own data
   function and the report says which parents it hangs off and that the choice
   is not derivable from the code.

Consequences, all needed for the number to close:

- DET of the group = the non-identifier, non-system columns of every member,
  **minus each child's foreign key to its parent** (`pedidoId` on the line is
  the subgroup's link, not an attribute the user recognises). A foreign key to a
  _different_ data function still counts, as IFPUG requires.
- A transaction touching the child touches the group: **one** FTR, shown as
  `reaches:Pedido (via ItemPedido)`.
- A write to the child maintains the group: ILF.
- `fp:explain` on the master lists each RET with the reason.

**Measured** on the three applications this package was validated against:
one groups nothing (every model has a query of its own), one folds `Fragment`
into `Page`, one folds `InpiClassificacao`, `InpiDespacho` and `InpiTitular`
into `InpiProcesso` — the "4 EIFs mirrored from an external registry" §9
mentions, which under the CPM are **one** EIF with 4 RET. About 15 FP over
~2,500. The rule groups little and never groups wrong, which is the right side
to err on: an invented RET is invisible; an invented ILF is 7 PF on an invoice.

`dataFunctions.grouping: 'none'` restores the pre-1.5.0 behaviour — every table
its own data function at RET 1 — for comparing against an old count. It is not
a preference. The former `retStrategy` is no longer read, and a configuration
that still carries it is told so.

---

## 11. What the count says it cannot decide

Two questions came out of counting real applications that no rule should answer
and no count should keep quiet about. Both are reported, with the amount at
stake and the key that records the decision; neither moves the number.

**Transactions that look like the same elementary process.** `GET /perfil` and
`GET /perfil/editar` walked the same queries and the same transformers, touched
the same stores, emitted the same DETs, and were 7 FP each. The CPM counts
identical processing logic once. Whether the second URL is a screen the user
needs or a second door to the same screen is not derivable from code, so the
pair is named — `GET /perfil ≡ GET /perfil/editar (7 FP at stake)` — and the
answer is `boundary.ignoreEntryPoints`. The key is narrow on purpose: same type,
same stores, same DET sources **and** the same bodies below the entry point.
Two fat controllers that merely read the same table are not flagged: with
nothing followed, nothing says the logic is the same.

**An EIF only a seeder writes.** Since 0.5.0 a seeder's inserts are not
maintenance, so a table only the seed populates is "used but not maintained" —
an EIF. That is right for a table mirroring data another system maintains in
production, and wrong for `roles`: reference data the team maintains is code
data under the CPM and is not counted at all. The code cannot tell the two apart
and should not try. It names them — `Role (5 FP)` — and says what each answer
costs; `boundary.infrastructure` records the first, keeping it records the
second.

---

## The total is more defensible than any single function

Worth stating plainly, because it shapes how the output should be used.

The spike built two independent implementations — one at file level, one at
method level — which classified transactions quite differently, and their
totals landed within 5% of each other. The reason is arithmetic: a low EI is
worth 3 and a low EO is worth 4, so misclassifying one for the other moves the
total by a single point.

The Vazquez benchmark confirmed it from outside: 8 of the 10 functions match
the published count exactly, and the two that do not are +1 and −1, cancelling
into an exact total.

The consequence cuts both ways:

- **Good for aggregate billing.** The total is stable under the classification
  decisions that are hardest to automate.
- **Bad for defending a single function in an audit.** Per-function agreement
  is weaker than the total suggests.

This is the central justification for `fp:explain`, and the reason the
per-function agreement is reported next to the total in the benchmark rather
than hidden behind it.
