# incidental_por_transacao — reference count

Fixture for plan 0.15 §B: **a write incidental in one transaction and the point of another**. One
action, `lembrarOrganizacao`, remembers the organisation last used. `GET /pedidos/:id` calls it on
the way to showing an order — a side effect of a page. `POST /organizacao/trocar` calls it because
the user switched organisation — the transaction exists for it. The CPM classifies each elementary
process by its own primary intent, so one declaration about the call cannot be right for both.
Written before the code was run.

| declaration | GET /pedidos/:param | POST /organizacao/trocar | total |
| ----------- | ------------------- | ------------------------ | ----- |
| none | EI, FTR 2, DET 1 — 3 | EI, FTR 1, DET 1 — 3 | **23** |
| `incidentalWrites({ methods: ['lembrarOrganizacao'] })` (0.14, everywhere) | EO, FTR 2, DET 3 — 4 | **EO**, FTR 1, DET 1 — 4: wrong, the switch is a write | **25** |
| `… , in: ['GET /pedidos/:param']` | EO — 4 | **EI — 3** | **24** |

Constant in every row: `Pedido` ILF 2 DET (7), `Preferencia` ILF 2 DET (7) — still written by this
application — and `POST /pedidos` EI (3).

An identity in `in` that no transaction has is reported:
`incidentalWrites("organizacao") in: 'GET /pedidos' matched no transaction: it had no effect`.
