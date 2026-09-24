# Tracing strategies

Catalogue of the organisation patterns that appear in AdonisJS applications and
the state of each one. The list is open by construction — see
`src/inventory/resolvers/types.ts`.

| pattern              | example                                                            | strategy                             | state                                                             |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------- |
| fat controller       | `await User.create(payload)`                                       | Lucid detector                       | **done**                                                          |
| same-class method    | `await this.persistExpiration(x)`                                  | `same-class-method`                  | **done**                                                          |
| action object        | `await new CreateUser().handle(p)`                                 | `action-object`                      | **done**                                                          |
| action in a variable | `const a = new CreateUser(); a.handle()`                           | `action-object`                      | **done**                                                          |
| static service       | `await UserService.create(p)`                                      | `static-service`                     | **done**                                                          |
| injected service     | `constructor(private users: UserService)` + `this.users.create(p)` | `property-service`                   | **done** — resolved from the type annotation, **no type checker** |
| module function      | `await createUser(p)`                                              | `module-function`                    | **done**                                                          |
| job                  | `await CreateUserJob.dispatch(p)`                                  | `job-dispatch`                       | **done**                                                          |
| Kysely repository    | `this.repo.create(p)` → `db.insertInto('users')`                   | `property-service` + Kysely detector | after v1 — Kysely is detected and reported as unsupported         |
| query builder        | `db.table('users').insert(p)`                                      | its own detector                     | after v1                                                          |

## First to claim it, wins

Syntactically identical shapes carry different meanings:
`CreateUserJob.dispatch(p)` and `UserService.create(p)` are both
`Identifier.method(args)`. Only the ORDER tells them apart.

This was not designed — it was discovered by a test, which caught
`static-service` swallowing the job fixture. Hence `resolveCall()` stops at the
first strategy that returns a result, and there is a regression test asserting
which strategy claims each pattern.

Consequence: `module-function` comes last. It matches any call on an imported
identifier and would swallow every more precise case.

Another trap in the same family: `Invite.findByOrFail(...)` is also
`Identifier.method(args)`. A model is a data store, not a body to walk into —
hence the ordering invariant in `ResolverContext.dataStoresBySymbol`: data
stores are collected BEFORE any handler is analysed.

## `@inject()` does not need the type checker

An earlier analysis in this project claimed that resolving
`constructor(protected billing: BillingService)` would require the TypeScript
type checker, and treated that as the most expensive decision in the design.

**It was wrong.** AdonisJS `@inject()` only works with an explicit type
annotation — that annotation is how the container knows what to inject. So the
type is always in the AST, as an imported identifier, and resolves through the
same path as any import.

It mattered a great deal: in a production application, 68 write routes stopped
at the first step on `this.someService.method()`. Resolving it took EI
detection from 40 to 84 out of 161 routes.

## Decision taken: jobs

When a handler dispatches a job that writes, is the write part of the **same**
transactional function, or a function of its own?

IFPUG counts by what the user recognises. If someone clicks "finish" and the
expected effect happens, it is one transaction — even if execution is
asynchronous. That argues for following the job as part of the transaction that
dispatches it.

But a **scheduled** job, which nobody dispatches, is an entry point of its own.

**Decision:** a job dispatched by a handler is followed as part of the same
transactional function. A scheduled job, which nobody dispatches, is an entry
point of its own — and stays out of v1, which collects only HTTP routes.

## Order

A lower `order` runs first. Specific strategies before generic ones:
`module-function` last, because it matches any call on an imported identifier
and would swallow the more precise cases.

Strategies coming from the user's configuration run before the built-in ones.
