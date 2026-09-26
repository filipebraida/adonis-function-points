# Counting in CI

For CI, or a one-off count on a project you do not want to touch:

```bash
npx @filipebraida/adonis-function-points count --root ./my-app
```

The engine itself boots nothing — it only reads files — and the standalone binary
needs no `.env`, no database, and no install inside the analysed project. The
`fp:*` commands declare `startApp: false` for the same reason.

**In CI, prefer the standalone binary.** Not for convenience: `node ace` validates
`start/env.ts` before it runs any command, so `node ace fp:count` fails on a
missing environment variable that has nothing to do with counting. Measured on a
production application, it stopped at `Missing environment variable "AUTHZ_STORE"`
and never reached the command. A pipeline that only checks out the code has no
secrets, and does not need them to count.

The standalone binary **does not replace installing**: a project that installs the
package keeps the `node ace fp:*` commands — which is the right front-end at a
developer's terminal, where the `.env` is already there — and both call the same
code, so they cannot disagree about a number.

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

Both front-ends exit non-zero when the count cannot be produced — coverage
below the minimum, an unreadable configuration, a saved count from a different
ruleset — so a CI job fails instead of publishing a number nobody can defend.

## What a saved count records

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
