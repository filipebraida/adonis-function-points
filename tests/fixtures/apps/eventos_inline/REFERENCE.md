# eventos_inline — reference count

Fixture for plan 0.9 §C: **a listener written inline is a listener**, and **a string
event is an event**. The application that reviewed 0.8.0 binds every listener as
`emitter.on('order:closed', async function ({ orderId }) { … })` — a string, an inline
function — and the collector read only `emitter.on(EventClass, [ListenerClass])`. Every
job those listeners dispatch was reported as "reached by no transaction", and none of
their writes was an FTR of the POST that emitted. Written before the code.

## The application

| store         | columns (besides `id`)   | role                                                                          |
| ------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `Pedido`      | `descricao`, `status`    | written by the POST, deleted by the DELETE: ILF                               |
| `Notificacao` | `pedidoId`, `mensagem`   | written by the job the inline listener of `pedido:criado` dispatches: **ILF** |
| `Auditoria`   | `pedidoId`, `acao`       | written by the inline arrow listener of `PedidoCancelado`: **ILF**            |

Two transactions:

| route                 | what it emits                                                     | who listens                                                                                                         |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `POST /pedidos`       | `emitter.emit('pedido:criado', { pedidoId })` — a **string** event | `emitter.on('pedido:criado', async function ({ pedidoId }) { … })` → `NotificarPedidoJob.dispatch` → writes `Notificacao` |
| `DELETE /pedidos/:id` | `PedidoCancelado.dispatch(id)` — a class event                     | `emitter.on(PedidoCancelado, async (event) => { … })` → writes `Auditoria`                                          |

## Reference: 27 unadjusted FP

| function            | type | FTR/RET | DET | complexity | FP     | DET origin                                                                                       |
| ------------------- | ---- | ------- | --- | ---------- | ------ | ------------------------------------------------------------------------------------------------ |
| Pedido              | ILF  | 1       | 2   | low        | 7      |                                                                                                  |
| Notificacao         | ILF  | 1       | 2   | low        | 7      | reached: the job the inline listener dispatches                                                  |
| Auditoria           | ILF  | 1       | 2   | low        | 7      | reached: the inline arrow listener                                                               |
| POST /pedidos       | EI   | 2       | 1   | low        | 3      | `descricao`; FTR Pedido + **Notificacao**, through the string event, the inline listener, the job |
| DELETE /pedidos/:id | EI   | 2       | 1   | low        | 3      | `:id`; FTR Pedido + **Auditoria**, through the class event and the inline arrow                  |
| **total**           |      |         |     |            | **27** |                                                                                                  |

And no job is reported: `NotificarPedidoJob` is reached by `POST /pedidos`.

## The rules

1. **A binding's listener may be a body, not a class.** `emitter.on(event, async function
   (payload) { … })` and `emitter.on(event, async (payload) => { … })` bind an inline body,
   located by its line in the file that binds it — the way a route's inline closure is
   already a handler. Followed like a listener class's `handle`.
2. **A string event is an event.** `emitter.on('pedido:criado', …)` binds the string;
   `emitter.emit('pedido:criado', payload)` and `emitSerial` in a body reach those
   listeners — the same decision as `Event.dispatch()` (§9): the effect belongs to the
   transaction that caused it. A name built at runtime (`` `pedido:${acao}` ``) binds nothing.
3. `start/**` is scanned for bindings: it is where a preload lives, and no alias points at it.
4. What a listener reaches — a job, a write — is the emitting transaction's, as before: FTRs
   and EI/EO follow, and a job so reached is no longer "reached by no transaction".

## What `afp@1.7.0` says — printed before the code

`Notificacao` and `Auditoria` are reached by nobody and drop out (§6.5.4); `POST /pedidos`
and `DELETE /pedidos/:id` are EIs at **1 FTR**; `NotificarPedidoJob` is reported as
"dispatched from start/events.ts, which no transaction reaches". **13 FP**.
