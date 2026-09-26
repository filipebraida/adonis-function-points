import { Node, VariableDeclarationKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

/**
 * Lucid's RAW query builder as a data access — plan 0.12 §B, counting-decisions §6.
 *
 *   db.from('orders').where(…).count('* as total')       read, aggregate
 *   db.from('users').select('name', 'email')             read, those columns
 *   db.from('orders as o').join('users as u', …).select('u.name', db.raw('count(*) as total'))
 *   db.from('orders').where(…).update({ … })            write
 *   trx.table('orders').insert({ … })                    write, through the transaction client
 *   db.rawQuery('select status, count(*) from orders …') read, tables and columns off the SQL
 *
 * The table named in `from` IS the store — the mapping (`static table`, or the name
 * derived from the class) has always existed. A whole management area of a reviewed
 * application was written this way and reached no store for three releases.
 *
 * Only the chain's OUTERMOST call answers, so one chain is one access. A builder kept in a
 * local and extended later (`const q = db.from('t')`, `q.where(…)`, `await q.select(…)`)
 * answers where it runs: the local's initializer is read in front of the use, and the
 * statements that only extend it answer nothing.
 */

/** table -> the stores it is: one for a model's table, two for a declared pivot */
export type TableMap = Map<string, string[]>

export type RawAccess = {
  mode: 'read' | 'write'
  /** the table the statement is about — `from`, `update`, `insert into` — or '?' */
  table: string
  /** the stores that table is; empty when no model declares it */
  stores: string[]
  /** the other tables read on the way (joins, SQL joins), resolved to stores */
  joined: string[]
  /** tables named that no model declares, in the order met */
  unmodelled: string[]
  /** columns named in a select, by store (qualified and aliased names resolve to their table) */
  selected: Map<string, string[]>
  /** an aggregate or a derived expression leaves one value */
  aggregate: boolean
  line: number
  expression: string
  /** a raw SQL statement the analysis could not read */
  unreadableSql?: boolean
  /** a table named by an expression, not a literal — its text */
  unreadableTable?: string
}

/** the builder's entry points off the database service */
const OPENS = new Set(['from', 'table', 'into', 'insertQuery', 'query', 'modifyQuery'])
const JOINS = new Set([
  'join',
  'innerJoin',
  'leftJoin',
  'leftOuterJoin',
  'rightJoin',
  'rightOuterJoin',
  'fullOuterJoin',
  'crossJoin',
])
const WRITES = new Set([
  'insert',
  'update',
  'delete',
  'del',
  'increment',
  'decrement',
  'truncate',
  'multiInsert',
])
const AGGREGATES = new Set(['count', 'countDistinct', 'sum', 'avg', 'min', 'max', 'exists'])
/** statements that execute; `db.raw(…)` is a fragment inside another call, not a query */
const RAW_STATEMENTS = new Set(['rawQuery', 'knexRawQuery'])
/** the roots a builder chain hangs off: the database service, a transaction client */
const ROOTS = /^(db|trx|database|Database|client)$/
/** where a template literal has an expression, the SQL text carries this */
const HOLE = '__expr__'

const camelCase = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

export function detectRawAccess(call: CallExpression, tables: TableMap): RawAccess | null {
  // one chain, one access: only the outermost link answers
  const parent = call.getParent()
  if (
    parent &&
    Node.isPropertyAccessExpression(parent) &&
    parent.getExpression() === call &&
    Node.isCallExpression(parent.getParent())
  )
    return null
  // a builder kept for later answers where it runs, not where it is built
  if (parent && Node.isVariableDeclaration(parent)) return null

  const chain = linksOf(call)
  if (!chain) return null
  // `q.where(…)` standing alone extends a builder kept in a local: nothing runs
  if (chain.throughLocal && parent && Node.isExpressionStatement(parent)) return null
  const links = chain.links

  let table: string | null = null
  let unreadableSql = false
  let unreadableTable: string | undefined
  const joinedTables: string[] = []
  const aliases = new Map<string, string>()
  const selectedByTable = new Map<string, string[]>()
  let aggregate = false
  let mode: 'read' | 'write' = 'read'
  const select = (owner: string, column: string) =>
    selectedByTable.set(owner, [...(selectedByTable.get(owner) ?? []), camelCase(column)])

  for (const link of links) {
    const callee = link.getExpression()
    if (!Node.isPropertyAccessExpression(callee)) continue
    const method = callee.getName()
    const first = link.getArguments()[0]

    if (OPENS.has(method) && first) {
      if (table) continue
      const named = textOf(first)
      const parsed = named && !named.includes(HOLE) ? tableAndAlias(named) : null
      if (parsed) {
        table = parsed.table
        if (parsed.alias) aliases.set(parsed.alias, parsed.table)
      } else unreadableTable = first.getText()
      continue
    }
    if (JOINS.has(method) && first) {
      const named = textOf(first)
      const parsed = named && !named.includes(HOLE) ? tableAndAlias(named) : null
      if (parsed) {
        joinedTables.push(parsed.table)
        if (parsed.alias) aliases.set(parsed.alias, parsed.table)
      }
      continue
    }
    if (WRITES.has(method)) {
      mode = 'write'
      continue
    }
    if (AGGREGATES.has(method)) {
      aggregate = true
      continue
    }
    if (method === 'select') {
      for (const argument of link.getArguments()) {
        const elements = Node.isArrayLiteralExpression(argument)
          ? argument.getElements()
          : [argument]
        for (const element of elements) {
          const named = textOf(element)
          const column = named === null ? null : columnOf(named)
          if (column === '*') continue
          if (!column) {
            // `db.raw('count(*) as total')`, a subquery: one derived value
            aggregate = true
            continue
          }
          select(column.owner ?? table ?? '?', column.name)
        }
      }
      continue
    }
    if (RAW_STATEMENTS.has(method) && first) {
      const sql = textOf(first)
      const parsed = sql === null ? null : parseSql(sql)
      if (parsed === 'no-table') continue
      if (!parsed) {
        unreadableSql = true
        continue
      }
      table ??= parsed.table
      mode = parsed.mode
      if (parsed.aggregate) aggregate = true
      joinedTables.push(...parsed.joined)
      for (const [alias, aliased] of parsed.aliases) aliases.set(alias, aliased)
      for (const [owner, columns] of parsed.columns) for (const c of columns) select(owner, c)
      continue
    }
  }

  const line = call.getStartLineNumber()
  const expression = call.getExpression().getText().replace(/\s+/g, '').slice(0, 80)
  if (!table && !unreadableSql && unreadableTable === undefined) return null

  const resolve = (name: string) => tables.get(aliases.get(name) ?? name)
  const stores = table ? (tables.get(table) ?? []) : []
  const unmodelled = [table, ...joinedTables].filter(
    (t): t is string => t !== null && !tables.has(t)
  )
  const joined = [...new Set(joinedTables.flatMap((t) => tables.get(t) ?? []))].filter(
    (store) => !stores.includes(store)
  )
  const selected = new Map<string, string[]>()
  for (const [owner, columns] of selectedByTable) {
    const owners = owner === '?' ? stores : (resolve(owner) ?? [])
    for (const store of owners) selected.set(store, [...(selected.get(store) ?? []), ...columns])
  }

  return {
    mode,
    table: table ?? '?',
    stores,
    joined,
    unmodelled: [...new Set(unmodelled)],
    selected,
    aggregate,
    line,
    expression,
    unreadableSql: unreadableSql || undefined,
    unreadableTable,
  }
}

/**
 * The chain's calls, root first — through ONE local holding a builder:
 * `const q = db.from('t').where(…)` read in front of `q.select(…)`.
 */
function linksOf(
  call: CallExpression,
  depth = 0
): { links: CallExpression[]; throughLocal: boolean } | null {
  const links: CallExpression[] = []
  let current: Node = call
  for (let step = 0; step < 40; step++) {
    if (Node.isCallExpression(current)) {
      links.unshift(current)
      current = current.getExpression()
      continue
    }
    if (
      Node.isPropertyAccessExpression(current) ||
      Node.isAwaitExpression(current) ||
      Node.isParenthesizedExpression(current) ||
      Node.isNonNullExpression(current)
    ) {
      current = current.getExpression()
      continue
    }
    break
  }
  if (!Node.isIdentifier(current)) return null
  if (ROOTS.test(current.getText())) return { links, throughLocal: false }
  if (depth > 0 || links.length === 0) return null

  // a local holding a builder
  const declaration = current
    .getSymbol()
    ?.getDeclarations()
    .find((d) => Node.isVariableDeclaration(d))
  if (!declaration || !Node.isVariableDeclaration(declaration)) return null
  // `const rows = await db.from(…)` holds rows, not a builder: `rows.map(…)` is no query
  const initializer = declaration.getInitializer()
  if (!initializer || !Node.isCallExpression(initializer)) return null
  const kept = linksOf(initializer, depth + 1)
  if (!kept) return null
  return { links: [...kept.links, ...links], throughLocal: true }
}

/**
 * A string the code names: a literal, a template (its expressions become a hole unless
 * they are themselves constant strings), or a `const` holding one.
 */
function textOf(node: Node, depth = 0): string | null {
  if (depth > 3) return null
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    return node.getLiteralValue()
  if (Node.isAsExpression(node) || Node.isParenthesizedExpression(node))
    return textOf(node.getExpression(), depth + 1)
  if (Node.isTemplateExpression(node)) {
    let text = node.getHead().getLiteralText()
    for (const span of node.getTemplateSpans()) {
      text += textOf(span.getExpression(), depth + 1) ?? ` ${HOLE} `
      text += span.getLiteral().getLiteralText()
    }
    return text
  }
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol()
    const target = symbol?.getAliasedSymbol() ?? symbol
    for (const declaration of target?.getDeclarations() ?? []) {
      if (!Node.isVariableDeclaration(declaration)) continue
      if (
        declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
      )
        continue
      const initializer = declaration.getInitializer()
      return initializer ? textOf(initializer, depth + 1) : null
    }
  }
  return null
}

const IDENT = '"?([a-z_][\\w]*)"?'

/** `'orders'`, `'orders as o'`, `'public.orders o'` */
function tableAndAlias(text: string): { table: string; alias?: string } | null {
  const match = text
    .trim()
    .match(new RegExp(`^(?:"?[a-z_][\\w]*"?\\.)?${IDENT}(?:\\s+(?:as\\s+)?${IDENT})?$`, 'i'))
  if (!match) return null
  return { table: match[1], alias: match[2] }
}

/**
 * A select item: `'name'`, `'o.name'`, `'o.name as label'` — a column, qualified or not;
 * `'*'` / `'o.*'` — every column; anything else — a derived value (null).
 */
function columnOf(text: string): { owner?: string; name: string } | '*' | null {
  const item = text.trim()
  if (/^([a-z_][\w]*\.)?\*$/i.test(item)) return '*'
  const match = item.match(new RegExp(`^(?:${IDENT}\\.)?${IDENT}(?:\\s+as\\s+"?[\\w]+"?)?$`, 'i'))
  if (!match) return null
  return { owner: match[1], name: match[2] }
}

/** words that can follow a table and are not its alias */
const NOT_ALIASES = new Set([
  'where',
  'on',
  'using',
  'left',
  'right',
  'inner',
  'outer',
  'full',
  'cross',
  'natural',
  'join',
  'group',
  'order',
  'limit',
  'offset',
  'having',
  'union',
  'window',
  'returning',
  'set',
  'values',
  'select',
  'lateral',
  'for',
  'as',
  'default',
  'on',
])

type ParsedSql = {
  table: string
  mode: 'read' | 'write'
  joined: string[]
  aliases: Map<string, string>
  columns: Map<string, string[]>
  aggregate: boolean
}

/**
 * The little SQL the analysis reads. The statement's table follows `update` / `insert
 * into` / `delete from`, or is the first real table after a `from`; every other table
 * after `from` or `join` is read on the way. Names a `with` defines are not tables; a
 * subquery in parentheses is read through its own `from`; `from now()` is a function. For
 * a `select`, the list names the columns — bare or qualified identifiers, renamed or not;
 * the rest (`count(*) as total`) is one derived value. A table where the template has an
 * expression cannot be read (null); a statement naming no table at all (`select
 * pg_advisory_xact_lock(?)`) is no data access ('no-table').
 */
function parseSql(sql: string): ParsedSql | null | 'no-table' {
  const text = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\bextract\s*\(\s*\w+\s+from\b/gi, 'extract(')
    .replace(/\bdistinct\s+from\b/gi, 'distinct_from')
    .replace(/\bon\s+conflict\b[\s\S]*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const ctes = new Set(
    [
      ...text.matchAll(
        /(?:\bwith(?:\s+recursive)?|,)\s*"?([a-z_][\w]*)"?\s+as\s*(?:not\s+)?(?:materialized\s*)?\(/gi
      ),
    ].map((m) => m[1].toLowerCase())
  )
  const aliases = new Map<string, string>()
  const found: string[] = []
  let hole = false
  const TABLE = new RegExp(
    `\\b(from|join|update|into)\\s+((?:"?[a-z_][\\w]*"?\\.)?"?[a-z_][\\w]*"?)(\\s*\\()?(?:\\s+(?:as\\s+)?${IDENT})?`,
    'gi'
  )
  for (const match of text.matchAll(TABLE)) {
    const [, , raw, call, alias] = match
    const table = raw.replace(/"/g, '').split('.').pop()!
    if (table.toLowerCase() === HOLE) {
      hole = true
      continue
    }
    if (call) continue
    const lower = table.toLowerCase()
    if (ctes.has(lower) || NOT_ALIASES.has(lower)) continue
    found.push(table)
    if (alias && !NOT_ALIASES.has(alias.toLowerCase())) aliases.set(alias, table)
  }

  const statement = new RegExp(
    `^(?:with\\b.*?\\)\\s*)?(?:update|insert\\s+into|delete\\s+from)\\s+(?:"?[a-z_][\\w]*"?\\.)?${IDENT}`,
    'i'
  )
  const write = text.match(statement)
  if (write && write[1].toLowerCase() === HOLE) return null
  if (found.length === 0) return hole ? null : 'no-table'

  const table = write ? write[1] : found[0]
  const joined = [...new Set(found.filter((t) => t !== table))]
  const columns = new Map<string, string[]>()
  let aggregate = false
  if (!write) {
    const list = text.match(/^select\s+(?:distinct\s+)?(.*?)\s+from\s/i)?.[1]
    if (list) {
      for (const item of splitTopLevel(list)) {
        const column = columnOf(item)
        if (column === '*') continue
        if (!column) {
          aggregate = true
          continue
        }
        const owner = column.owner ?? table
        columns.set(owner, [...(columns.get(owner) ?? []), column.name])
      }
    } else aggregate = true // a `with` whose final select reads its own names: derived values
  }
  return { table, mode: write ? 'write' : 'read', joined, aliases, columns, aggregate }
}

/** `a, f(b, c), d` -> ['a', 'f(b, c)', 'd'] */
function splitTopLevel(list: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const char of list) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) {
      items.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) items.push(current.trim())
  return items
}
