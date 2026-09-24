import { test } from '@japa/runner'

import path from 'node:path'

import { discoverApp } from '../../src/inventory/app_context.js'
import { samePath, toPosix } from '../../src/inventory/paths.js'
import { analyze } from '../../src/pipeline.js'
import { appFixturePath } from '../helpers.js'

/**
 * Collects every path the inventory exposes, by key name rather than by a
 * fixed list — so a path field added later is covered without anyone
 * remembering to come back here.
 */
const PATH_KEYS = new Set(['file', 'app', 'config'])

function pathsIn(value: unknown, key = ''): string[] {
  if (typeof value === 'string') return PATH_KEYS.has(key) ? [value] : []
  if (Array.isArray(value)) return value.flatMap((item) => pathsIn(item, key))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([name, item]) => pathsIn(item, name))
  }
  return []
}

/**
 * Two path styles meet in this package: ts-morph always returns forward
 * slashes, including on Windows, while node's `path.join` returns backslashes
 * there. Both reach `HandlerRef.file`, which the call graph uses as a cache
 * key — so two spellings of one file are two keys, the body is analysed twice,
 * and the duplicated scope entry changes the hash `fp:diff` compares.
 *
 * These assertions are free on Linux and only have teeth on Windows, which is
 * why the suite runs on both.
 */
test.group('paths: one canonical spelling', () => {
  test('every path the inventory emits is posix', async ({ assert }) => {
    for (const app of ['minimal_flat', 'minimal_nogen', 'model_hooks']) {
      const { inventory, count } = await analyze(appFixturePath(app), {
        // deliberately native, to prove the emitted `source` is canonical
        // whatever spelling the caller used
        configFile: path.join(appFixturePath(app), 'config', 'function_points.ts'),
      })
      const found = [...pathsIn(inventory), ...pathsIn(count)]

      assert.isNotEmpty(found, `${app}: no path collected, the walk is broken`)
      for (const file of found) {
        assert.notInclude(file, '\\', `${app}: ${file}`)
      }
    }
  })

  /**
   * The assertion above cannot fail on Linux, where `path.join` already emits
   * forward slashes — so on the machine this is usually run, it proves nothing
   * unless the collector itself is known to work. This checks the collector.
   */
  test('the walk would catch a windows path if one leaked in', ({ assert }) => {
    const leaked = pathsIn({
      app: 'D:/app',
      behaviors: [{ trace: [{ file: 'D:\\app\\models\\book.ts' }] }],
      source: { config: 'D:\\app\\config\\function_points.ts' },
      ignored: { name: 'not\\a\\path' },
    })

    assert.deepEqual(leaked, [
      'D:/app',
      'D:\\app\\models\\book.ts',
      'D:\\app\\config\\function_points.ts',
    ])
    assert.isTrue(
      leaked.some((file) => file.includes('\\')),
      'the collector has to see the backslash, or the group is decorative'
    )
  })

  test('resolveSpecifier agrees with what ts-morph would return', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))
    const resolved = app.resolveSpecifier('#models/book')!

    assert.notInclude(resolved, '\\')
    assert.equal(resolved, toPosix(resolved), 'already canonical, so no conversion is needed')
  })

  test('the discovered roots are posix too', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_nogen'))

    assert.notInclude(app.root, '\\')
    for (const root of app.scanRoots) assert.notInclude(root, '\\')
    for (const file of app.routeFiles) assert.notInclude(file, '\\')
  })

  test('so are the generated artefacts', async ({ assert }) => {
    const app = await discoverApp(appFixturePath('minimal_flat'))

    for (const artefact of Object.values(app.generated)) {
      if (artefact) assert.notInclude(artefact, '\\')
    }
  })
})

test.group('paths: samePath', () => {
  test('compares across the two styles', ({ assert }) => {
    assert.isTrue(samePath('D:\\app\\models\\book.ts', 'D:/app/models/book.ts'))
    assert.isTrue(samePath('/app/models/book.ts', '/app/models/book.ts'))
  })

  test('a missing side is never equal', ({ assert }) => {
    assert.isFalse(samePath(undefined, '/a.ts'))
    assert.isFalse(samePath('/a.ts', undefined))
    assert.isFalse(samePath(undefined, undefined))
  })

  test('different files stay different', ({ assert }) => {
    assert.isFalse(samePath('/app/models/book.ts', '/app/models/author.ts'))
  })
})
