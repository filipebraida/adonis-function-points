# Benchmark

The only reference in this project not produced by its own authors is the case
study published in **Vazquez, Simões & Albert (2011)**, the same one used by the
COPPE/UFRJ dissertation on the _Ligeiro_ tool (Pinel, 2012).

The fixture and the reference count were frozen in their own commit **before**
the counter was ever run against them, with the transcription choices written
down first. Without that the independence would be illusory.

|                                     | total     | vs reference |
| ----------------------------------- | --------- | ------------ |
| **Vazquez et al. (2011), manual**   | **46 FP** | —            |
| **this package**                    | **46 FP** | **0%**       |
| Ligeiro, automated (Pinel 2012)     | 52 FP     | +13%         |
| Ligeiro, manual under its own rules | 43 FP     | −6.5%        |

Eight of the ten functions match exactly. The two that do not were **predicted
in writing before the run**, and come from the standard rather than from
defects:

- **+1** `Consulta Apontamento Diário` is an EQ in the reference; AFP §6.5.3
  requires collapsing EQ into EO, and an EO weighs more in the same band.
- **−1** `Apontamento c/ Justificativa`: the IFPUG manual counts 1 DET for the
  user message, AFP does not.

They cancel out, which is exactly why the total is reported alongside the
function-by-function agreement rather than on its own.

Reproduce it with `npm test` — the benchmark is
`tests/acceptance/vazquez.spec.ts` (from the repository root), and the reference is
[`tests/fixtures/apps/vazquez/REFERENCE.md`](../tests/fixtures/apps/vazquez/REFERENCE.md).
