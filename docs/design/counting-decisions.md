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

> **Not in v1.** The `node_modules` boundary — what makes mechanism 3 possible
> — is decided but not implemented. Mechanisms 1 and 2 are.

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

The DETs of an EO = **the union of the distinct fields of the data stores read
in the implementation scope**, narrowed by whatever is statically visible:

| what the code does                                        | DETs                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `Book.query()` / `selectFrom('books').selectAll()`        | every column of `books`                                        |
| `.select(['title', 'isbn'])`                              | only the selected ones                                         |
| `.preload('author')` / join                               | + the related columns                                          |
| passes through a transformer / DTO listing fields         | **the transformer's keys** — that is what crosses the boundary |
| a derived scalar prop (`total`, `canEdit`)                | 1 DET each — derived data leaving the boundary                 |
| a field that enters and exits (a filter echoed on screen) | counted once                                                   |

**Known and accepted divergence:** a human counter counts the fields
_displayed_; with no `.select()` and no transformer we count the whole table and
overestimate. That is the trade AFP makes on purpose — repeatability over
fidelity — and it goes into each function's `Rationale` as
`detSource: 'all-columns'` vs `'transformer'` vs `'select'`, so `fp:calibrate`
can measure the bias per origin.

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
  overrides: {
    'POST /petitions': {
      det: 42,
      reason: 'JSON Schema form; 42 fields the user fills, read from the definition in force',
    },
  },
})
```

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
