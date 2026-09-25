# system_timestamps — reference count

Fixture for one decision: a column the **system** maintains — `autoCreate` /
`autoUpdate` on `@column.dateTime()` — is not a DET, on the data function nor
on any output that carries it. Written before the code.

## The application

One model, `Tarefa`, with six columns:

| column        | decorator                                         | DET? | why                                   |
| ------------- | ------------------------------------------------- | ---- | ------------------------------------- |
| `id`          | `@column({ isPrimary: true })`                    | no   | surrogate key — already excluded      |
| `titulo`      | `@column()`                                       | yes  |                                       |
| `concluida`   | `@column()`                                       | yes  |                                       |
| `concluidaEm` | `@column.dateTime()`                              | yes  | a date the USER sets — the control    |
| `createdAt`   | `@column.dateTime({ autoCreate: true })`          | no   | the system stamps it                  |
| `updatedAt`   | `@column.dateTime({ autoCreate: true, autoUpdate: true })` | no | the system stamps it           |

Three transactions:

| route                 | what leaves the boundary                                    |
| --------------------- | ----------------------------------------------------------- |
| `GET /tarefas`        | the model, untouched — every column                         |
| `GET /tarefas/recentes` | `TarefaTransformer` emitting `titulo` and `createdAt`      |
| `POST /tarefas`       | validator with `titulo`, writes `Tarefa`                     |

## Reference: 18 unadjusted FP

| function              | type | FTR/RET | DET | complexity | FP     | DET origin                                     |
| --------------------- | ---- | ------- | --- | ---------- | ------ | ---------------------------------------------- |
| Tarefa                | ILF  | 1       | 3   | low        | 7      | `titulo`, `concluida`, `concluidaEm`           |
| GET /tarefas          | EO   | 1       | 3   | low        | 4      | the same three, `output:`                      |
| GET /tarefas/recentes | EO   | 1       | 1   | low        | 4      | `titulo` — `createdAt` is emitted and still not a DET |
| POST /tarefas         | EI   | 1       | 1   | low        | 3      | `titulo`                                       |
| **total**             |      |         |     |            | **18** |                                                |

## The rule, and where it diverges from the letter of AFP

IFPUG defines a DET as a *user recognizable* attribute. `isPrimary` is already
excluded on that ground: the user does not recognise a surrogate key. A column
the framework stamps on insert and update is the same kind of field — the user
neither supplies it nor maintains it — so it is excluded on the same ground, on
the data function and on every output, including a transformer that re-emits
it.

AFP §7.2 says "each table field shall be identified as a DET", which on its
letter would count both. The package already departs from that letter for the
primary key; this extends the same departure to the same kind of field, and
records it here rather than hiding it. It is **not** configurable: an option
nobody can defend either way is not a business decision.

The control is `concluidaEm`: a `dateTime` the user sets. It counts. The rule
is about who maintains the column, not about its type.

## What the current rule set says, predicted

Every function is at the same points either way — the fixture is too small to
cross a band — which is exactly why the reference asserts DETs and not only
points:

| function              | current DET | reference DET |
| --------------------- | ----------- | ------------- |
| Tarefa                | 5           | 3             |
| GET /tarefas          | 5           | 3             |
| GET /tarefas/recentes | 2           | 1             |

Where it does cross a band on a real application: an EO at 20 DET drops to
average at 18, an ILF at 20 drops to low at 18, an EI at 5 drops to low at 4.
