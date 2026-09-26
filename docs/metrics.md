# `fp:metrics` — the counterweight

If function points pay, the team optimises function points: more models, more
endpoints, less reuse. So density and coupling are reported from the **same**
inventory, and this command exists to put them on the same page as the number.

```
Density
  FP per data store:            27.0
  transactions per data store:  5.4

Conformance
  inputs with a validator      100.0%   (30/30)
  entry points with a handler  100.0%   (163/163)
  data stores reached           96.7%   (29/30)
  tracing coverage              95.1%   (15 unresolved calls)

module                  FP  trans stores     I  depends on
pedidos                211     33      8  0.60  inventores, tecnologias, users
portal                  69     15      0  1.00  contato, documentos, inventores, ...
inpi                    70     11      6  0.00

Mutual dependencies (cycle candidates)
  inventores <-> tecnologias
```

The denominator of the first line is the transactions that **take** input, not
every write. Measured over every write it read 39% on a healthy application, which
invites the conclusion that 61% of its writes are unvalidated — and they are not:
most are workflow triggers (`POST /orders/:id/submit`) that carry nothing beyond
the route parameter. A metric that makes the reader draw a false conclusion is
worse than no metric.

`I` is Martin's instability, `Ce / (Ca + Ce)`: 0 means everyone depends on it and
it depends on nobody, 1 means the reverse. A module at 0 that changes often is
where change hurts. Cycles are **reported, not scored** — what to do about one is
the team's decision, and a number would hide it.
