# arquivo_declarado — reference count

Fixture for plan 0.14 §D: **a logical file the analysis cannot see, declared**. Three data the user
recognises and the code reaches by paths the analysis does not follow:

| logical file   | where it lives | how the code reaches it |
| -------------- | -------------- | ----------------------- |
| roles          | table `papeis`, created by an authorization package; no model | `permissoes.store.criarPapel / excluirPapel / listarPapeis` — the package's API |
| settings       | a persistent cache key, typed `Configuracoes` | `ConfiguracoesService.get` / `atualizar` |
| appointments   | another system's HTTP API, typed `AgendamentoExterno` | `AgendaService.listarPorPessoa` |

Nothing in the code changes to count them: the configuration says what each is, where its structure
comes from, and which calls read or write it. Written before the code.

## Without a declaration — what 0.13 prints: 0 FP

No store the analysis knows; the six routes are listed as not counted (§A).

## With the three declarations — 40 FP

```ts
logicalFiles: {
  Papel: {
    table: 'papeis',
    writes: [/\bpermissoes\.store\.(criarPapel|excluirPapel)$/],
    reads: [/\bpermissoes\.store\.listarPapeis$/],
    reason: 'roles the administrator maintains through the authorization package',
  },
  Configuracoes: {
    type: 'Configuracoes',
    exclude: ['atualizadoEm'],
    reads: ['ConfiguracoesService.get'],
    writes: ['ConfiguracoesService.atualizar'],
    reason: 'deadline and goal, set by the administrator, kept in a persistent cache',
  },
  Agendamento: {
    type: 'AgendamentoExterno',
    reads: ['AgendaService.listarPorPessoa'],
    reason: 'appointments read from the scheduling system',
  },
}
```

| function                  | type | FTR/RET | DET | FP | DET origin |
| ------------------------- | ---- | ------- | --- | -- | ---------- |
| Papel                     | ILF  | 1       | 2   | 7  | `generated-schema:papeis.nome`, `.guarda` (`id` and the stamp are not DETs) |
| Configuracoes             | ILF  | 1       | 2   | 7  | `declared-type:Configuracoes.prazoDias`, `.metaPct` (`atualizadoEm` excluded) |
| Agendamento               | EIF  | 1       | 3   | 5  | `declared-type:Agendamento.data`, `.local`, `.situacao` — read only |
| GET /papeis               | EO   | 1       | 1   | 4  | `papeis`, a value the package hands back |
| POST /papeis              | EI   | 1       | 1   | 3  | `request:nome` — writes Papel through `criarPapel` |
| DELETE /papeis/:param     | EI   | 1       | 1   | 3  | `:nome` — reads and writes Papel |
| GET /configuracoes        | EO   | 1       | 2   | 4  | `prazoDias`, `metaPct` |
| PUT /configuracoes        | EI   | 1       | 2   | 3  | `request:prazoDias`, `request:metaPct` |
| POST /agendamentos/listar | EO   | 1       | 4   | 4  | `request:cpf`, and the appointments handed on whole: `output:Agendamento.data`, `.local`, `.situacao` (§6) |
| **total**                 |      |         |     | **40** | |

`GET /configuracoes` stays an **EO**: `get` saves the defaults on first read (`salvar`), and the
declaration names the write where the intent is — `atualizar` — not the `salvar` both go through.

The report says it: `3 logical file(s) declared in logicalFiles: Agendamento (type AgendamentoExterno,
3 DET); Configuracoes (type Configuracoes, 2 DET); Papel (table papeis, 2 DET from the generated
schema) — 19 FP as data functions, reached by declaration from 6 transaction(s)`.

## A declaration that matches nothing

A `reads` or `writes` entry that no call and no body matches is reported:
`logicalFiles.Papel.reads[1] (/listarTodos/) matched nothing: it had no effect`. A `type` the
application does not declare, or a `table` nothing describes, is reported the same way and the file is
not counted.

## The rules

1. Structure comes from where it already is: `table` → the model reading it, or the generated-schema
   class (0.13 §B); `type` → the members of a type or interface the application declares. Nothing
   invents a column. `exclude` drops members that are not user-recognisable.
2. Who reads and who writes is declared per entry: a RegExp over the callee's text (a package's API),
   or an application body — `Class.method`, or a function's name — reached by the walk.
3. From there nothing is special: a transaction reaching a declared write is an EI and has the file as
   FTR; a file some transaction writes is an ILF, one only read an EIF (§6.5.4). An incidental write
   (§C) stays incidental.
4. Every declared file is listed with the origin of its DETs, the FP it contributes and the
   transactions that reach it by declaration; a declaration without effect is reported.
