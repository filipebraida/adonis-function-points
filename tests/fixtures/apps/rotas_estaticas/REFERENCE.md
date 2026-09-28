# rotas_estaticas — reference

Fixture for plan 0.14 §A: **the whole list of routes not counted**. One route reads a store
(`GET /avisos`: `Aviso.all()`, EO, and `Aviso` an EIF); 27 routes render a static text and reach
no store. Written before the code.

- Count: `Aviso` EIF 1 DET 5 FP, `GET /avisos` EO 1 DET 1 FTR 4 FP — **9 FP**.
- The warning lists 25 of the 27 and ends `… and 2 more — fp:inventory lists every one under "not counted"`.
- `count.confidence.notCounted` and `inventory.notCounted` carry all 27, `reason: 'reaches no data store'`.
- `fp:inventory` prints a section `not counted (27)` with every one of them.

Under 0.13.0 the warning ended `… and 2 more — fp:inventory lists every entry point`, and
`fp:inventory` listed none: the sentence pointed at something that did not exist.
