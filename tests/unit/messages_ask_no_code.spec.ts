import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@japa/runner'

/**
 * NO MESSAGE ASKS FOR CODE — plan 0.13 §A
 *
 * The library counts the code as it is, or says what it cannot read and points at the
 * configuration. A message that tells a team to write a model, a relation or a literal
 * so that the counter can see something is the counter dictating the code — and the
 * measurement stops being theirs. The 0.12 shipped one ("declare a model"); this keeps
 * the next one out.
 *
 * Only string and template literals are read: a comment may describe the code freely.
 */
const ASKS_FOR_CODE = [
  /declare a model/i,
  /(create|add|write) an? (model|relation|@manyToMany|decorator)/i,
  /name the table in a literal/i,
  /\bin the code\b.*\b(add|declare|create|rename|move)\b/i,
  /\b(refactor|rewrite) (the|your)\b/i,
]

const SRC = join(import.meta.dirname, '..', '..', 'src')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
  })
}

/** the text of every string and template literal of a file, comments left out */
function literalsOf(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g)].map(
    (m) => m[0]
  )
}

test.group('messages', () => {
  test('no message of the library asks the application to change its code', ({ assert }) => {
    const offenders: string[] = []
    for (const file of sources(SRC)) {
      for (const literal of literalsOf(readFileSync(file, 'utf8'))) {
        if (ASKS_FOR_CODE.some((pattern) => pattern.test(literal)))
          offenders.push(`${file.slice(SRC.length + 1)}: ${literal.slice(0, 120)}`)
      }
    }
    assert.deepEqual(offenders, [], offenders.join('\n'))
  })

  test('the check itself catches the message 0.12 shipped', ({ assert }) => {
    const shipped =
      '`raw query on a table no model declares: ${t} — declare a model, or the table is not counted`'
    assert.isTrue(literalsOf(shipped).some((l) => ASKS_FOR_CODE.some((p) => p.test(l))))
  })
})
