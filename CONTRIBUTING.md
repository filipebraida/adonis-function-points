# Contributing

```bash
pnpm install
pnpm test              # lint + 427 tests, from source
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
