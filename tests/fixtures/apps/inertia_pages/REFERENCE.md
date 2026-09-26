# inertia_pages — reference count

Fixture for plan 0.7 §B / 0.8 §D: **what the page shows is what leaves**, for the
one case the delivery rule (§A′) left open — a store handed to the page RAW, no
transformer, no `.select()`. The CPM defines an output's DETs by what the user
sees; the controller says which store, the page says which columns. Written before
the code; what `afp@1.7.0` prints is at the end.

## The application

| store   | columns (besides `id`)                                                                  | role                    |
| ------- | --------------------------------------------------------------------------------------- | ----------------------- |
| `Livro` | `titulo`, `autor`, `isbn`, `ano`, `editora`, `paginas`, `idioma`, `resumo`, `capaUrl`   | read only: EIF, 9 DET   |

Five transactions, every one delivering `Livro` rows raw:

| route                  | page                                                                                                | shows                        |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------- |
| `GET /livros`          | `inertia/pages/livros/index.tsx` — `livros.map((livro) => …)` reads `titulo`, `autor`, `ano`        | 3 columns                    |
| `GET /livros/:id`      | `livros/show.tsx` hands the row to `<Ficha livro={livro} />` (`~/components/ficha.tsx`): `titulo`, `isbn` | 2 columns, one level down |
| `GET /livros/destaques`| `livros/destaques.tsx` → `<Vitrine livros />` → `<Capa livro />`: two levels                        | **unreadable**: every column, reported |
| `GET /catalogo.xml`    | `view.render('catalogo')` → `resources/views/catalogo.edge`: `@each(livro in livros)` shows `titulo`, `isbn` | 2 columns             |
| `GET /livros/ambiguo`  | two files answer to `livros/ambiguo` (`ambiguo.tsx` and `ambiguo/index.tsx`)                        | **unreadable**: every column, reported |

## Reference: 25 unadjusted FP

| function              | type | FTR | DET | complexity | FP     | DET origin                                                        |
| --------------------- | ---- | --- | --- | ---------- | ------ | ----------------------------------------------------------------- |
| Livro                 | EIF  | 1   | 9   | low        | 5      | columns, minus `id` — the file is what it is, whatever a page shows |
| GET /livros           | EO   | 1   | 3   | low        | 4      | `page:Livro.titulo`, `.autor`, `.ano`                              |
| GET /livros/:id       | EO   | 1   | 3   | low        | 4      | `:id` + `page:Livro.titulo`, `.isbn` — read in the child component |
| GET /livros/destaques | EO   | 1   | 9   | low        | 4      | `output:Livro.*` — the reader stopped at `Vitrine`; **reported**   |
| GET /catalogo.xml     | EO   | 1   | 2   | low        | 4      | `page:Livro.titulo`, `.isbn` — from the Edge template              |
| GET /livros/ambiguo   | EO   | 1   | 9   | low        | 4      | `output:Livro.*` — two pages answer to the name; **reported**      |
| **total**             |      |     |     |            | **25** |                                                                   |

## The rules

1. **The page is found by convention, or not at all.** `inertia.render('livros/index')`
   → `inertia/pages/livros/index.tsx` (the default), or `app/<first>/ui/pages/<rest>.tsx`
   (the domain-module layout), or any `**/pages/livros/index.tsx` under the root outside
   `node_modules`. **Exactly one** match is read; zero or two are reported by transaction
   ("page not found" / "two pages answer to the name") and the store leaves whole, as
   before. The `pages:`/`resolve` function of `config/inertia.ts` is not evaluated: a
   convention is read, a function is not run.
2. **A raw store's DETs are the columns the page reads off it.** From the component's
   props — destructured (`{ livros }`), renamed (`{ livros: rows }`), or `props.livros` —
   through the body: `xs.map((x) => …)` and `for…of` bind a row; `x.titulo` in JSX or in
   an expression is one column; `x.autor.nome` on a declared relation is a column of the
   related store, which leaves too; `const { titulo } = x` is a column. A column the
   store does not declare (`livro.diasRestantes`, computed) counts nothing here — it is
   not the store's.
3. **One level of components.** `<Ficha livro={livro} />`: the tag's import resolves
   (tsconfig `paths` and relative imports; `~/*` → `./inertia/*` as the default when no
   tsconfig says otherwise), the component's props parameter binds the row, and its body
   is read the same way. A second level (`<Capa livro />` inside `Vitrine`), a spread
   (`{...livro}`), `JSON.stringify(livro)`, a component from a package (`<Table
   data={livros} />`) or `Object.keys(livro)` make the store **unreadable on that page**:
   every column counts, and the transaction is reported with the reason. Overestimating
   in the open, never a floor: a floor would undercount what the user sees.
4. **Edge by the same door.** `view.render('catalogo', props)` → `resources/views/catalogo.edge`:
   `{{ x.col }}` / `{{{ x.col }}}` are columns, `@each(x in xs)` binds a row of `xs`,
   `@if(x.col)` reads a column; `@include('partials/x')` and `@component('x')` are
   followed one level with the same names in scope. Anything else that mentions the row
   (`{{ x }}`, `@!component('c', { livro })` deeper) makes it unreadable, as above.
5. **Only the raw store changes.** A transformer's keys, a `.select()`, a derived scalar,
   an echoed input and a literal's leaves are what §6 already says; the page refines
   exactly the row the CPM would ask about — "what does the user see of this record?" —
   and nothing else. The data function keeps its 9 DET: the file is what it is.

## What `afp@1.7.0` says — printed before the code

Every page delivers `Livro` whole: `GET /livros` 9 DET, `GET /livros/:id` 10,
`destaques` 9, `catalogo.xml` 9, `ambiguo` 9 — and every one of them is a **4**, because
an EO with one FTR is "low" up to 19 DET. Total **25**, the same as the reference.
The first draft of this table had `destaques` and `ambiguo` at 5 FP, reading the EO
band wrong; the print corrected it before any code ran. So this fixture, like
`render_props`, **moves no points and moves every DET**: it asserts what the DETs are
made of and where the report says it could not look. The measurement on the three
applications is what says how much of the 34 EOs still carrying raw columns (719 DETs,
24 of them above "low") a page reader moves.
