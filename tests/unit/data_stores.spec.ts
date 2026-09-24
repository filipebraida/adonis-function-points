import { test } from '@japa/runner'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectDataStores } from '../../src/inventory/sources/data_stores.js'
import type {
  CollectedDataStore,
  DataStoreCollection,
} from '../../src/inventory/sources/data_stores.js'
import { fixturePath } from '../helpers.js'

const collect = async (root: string) => collectDataStores(await discoverApp(root))

const namesOf = (store: CollectedDataStore) => store.attributes.map((a) => a.name).sort()

const storeNamed = (result: DataStoreCollection, name: string): CollectedDataStore => {
  const found = result.stores.find((s) => s.name === name)
  if (!found) throw new Error(`data store "${name}" not found`)
  return found
}

/**
 * The failure this group exists to make impossible: an application can hold
 * dozens of model files and ZERO `extends BaseModel` from Lucid — the models
 * extend generated schema classes. Detecting a model by the file alone, without
 * following the inheritance chain, would count zero for the whole application,
 * in silence.
 */
test.group('data functions: definition styles', () => {
  const STYLES = ['direct', 'generated_schema', 'composed_mixin', 'custom_base']

  test('the four styles describe the same columns', async ({ assert }) => {
    const expected = ['createdAt', 'email', 'fullName', 'id']

    for (const style of STYLES) {
      const result = await collect(fixturePath('models', style))
      assert.deepEqual(namesOf(storeNamed(result, 'User')), expected, `style ${style}`)
    }
  })

  test('finds every model, not just the first', async ({ assert }) => {
    for (const style of STYLES) {
      const result = await collect(fixturePath('models', style))
      assert.deepEqual(result.stores.map((s) => s.name).sort(), ['Post', 'User'], `style ${style}`)
    }
  })

  test('the primary key is marked as an identifier', async ({ assert }) => {
    for (const style of STYLES) {
      const user = storeNamed(await collect(fixturePath('models', style)), 'User')
      const ids = user.attributes.filter((a) => a.isIdentifier).map((a) => a.name)
      assert.deepEqual(ids, ['id'], `style ${style}`)
    }
  })

  test('the physical table comes from `static table`', async ({ assert }) => {
    const result = await collect(fixturePath('models', 'direct'))
    assert.equal(storeNamed(result, 'User').table, 'users')
    assert.equal(storeNamed(result, 'Post').table, 'posts')
  })

  /** Required by identity across versions (counting-decisions §5). */
  test('a composition relation becomes a candidate subgroup', async ({ assert }) => {
    const user = storeNamed(await collect(fixturePath('models', 'direct')), 'User')
    assert.include(user.subgroups, 'Post')
  })

  /** Provenance is a requirement: a number without an origin is indefensible. */
  test('every attribute carries file and line', async ({ assert }) => {
    const user = storeNamed(await collect(fixturePath('models', 'direct')), 'User')
    for (const attribute of user.attributes) {
      assert.match(attribute.provenance.file, /\.ts$/)
      assert.isAbove(attribute.provenance.line ?? 0, 0)
    }
  })
})

test.group('data functions: source and boundary', () => {
  /**
   * `static $columns` is the canonical list generated from the migrations. When
   * present it prevails over reading the decorators — and the `DataStore`
   * records that, because a count from the AST and one from the generated
   * schema are not equivalent.
   */
  test('records which source the columns came from', async ({ assert }) => {
    const ast = storeNamed(await collect(fixturePath('models', 'direct')), 'User')
    assert.equal(ast.columnSource, 'ast')

    const generated = storeNamed(await collect(fixturePath('models', 'generated_schema')), 'User')
    assert.equal(generated.columnSource, 'generated-schema')
  })

  /**
   * The `@acme/auditable` mixin comes from a bare specifier — outside the
   * application. The package has no way of knowing what it adds.
   *
   * Saying "I don't know" is a requirement: if a package mixin added a column
   * (soft-delete adds `deletedAt`), pretending it does not exist would be
   * counting wrong in silence. See counting-decisions §4.
   */
  test('an unresolved package mixin enters the coverage report', async ({ assert }) => {
    const result = await collect(fixturePath('models', 'composed_mixin'))

    const external = result.unresolved.find((u) => u.expression === 'Auditable')
    assert.exists(external, 'the package mixin was not reported')
    assert.match(external!.reason, /outside the application/i)
  })

  /**
   * KNOWN GAP: a mixin factory (`compose(Base, withSlug())`) is local to the
   * application, but the column only exists on the class the function returns.
   * Resolving that requires evaluating the call's return value.
   *
   * What is NOT acceptable is reporting the wrong reason: saying "outside the
   * application" about code that is inside it would send the reader to the
   * wrong place. If the factory is ever resolved, this test fails and the gap
   * leaves the list.
   */
  test('a local mixin factory is reported for the right reason', async ({ assert }) => {
    const result = await collect(fixturePath('models', 'composed_mixin'))
    const factory = result.unresolved.find((u) => u.expression.includes('withSlug'))

    assert.exists(factory, 'the mixin factory was not reported')
    assert.match(factory!.reason, /mixin factory/i)
    assert.notMatch(factory!.reason, /outside the application/i)
  })

  test('a style with no mixin invents no unresolved entry', async ({ assert }) => {
    for (const style of ['direct', 'generated_schema']) {
      const result = await collect(fixturePath('models', style))
      assert.isEmpty(result.unresolved, `style ${style}`)
    }
  })

  /**
   * A base class has no table — counting it inflates the total.
   *
   * This is not a laboratory case: applications commonly define their own
   * `BaseModel`, which in turn extends Lucid's through an aliased import.
   * Without this rule that class becomes a phantom data store in every
   * application using the pattern.
   */
  test('a class used as a base by another model is not a data store', async ({ assert }) => {
    const result = await collect(fixturePath('models', 'custom_base'))

    assert.deepEqual(result.stores.map((s) => s.name).sort(), ['Post', 'User'])
    assert.notInclude(
      result.stores.map((s) => s.name),
      'BaseModel'
    )
  })

  /** But its columns are inherited by whoever extends it. */
  test('columns of a custom base are inherited', async ({ assert }) => {
    const user = storeNamed(await collect(fixturePath('models', 'custom_base')), 'User')
    assert.include(namesOf(user), 'createdAt')
  })

  /** The generated file is a BASE for models, not a model itself. */
  test('generated schema classes do not become data stores', async ({ assert }) => {
    const result = await collect(fixturePath('models', 'generated_schema'))
    assert.notInclude(
      result.stores.map((s) => s.name),
      'UserSchema'
    )
  })
})
