Monorepo root: it has a `package.json` but no `adonisrc.ts`, so it is not an
AdonisJS application root. Pointing the counter here used to produce 0 FP at
100% coverage and exit 0 — a confident zero, green in CI.
