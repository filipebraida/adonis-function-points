import { test } from '@japa/runner'
import path from 'node:path'

import { discoverApp } from '../../src/inventory/app_context.js'
import { collectDataStores } from '../../src/inventory/sources/data_stores.js'
import { analyzeHandler, createAnalyzer } from '../../src/inventory/graph/call_graph.js'
import type { HandlerRef } from '../../src/types.js'
import { fixturePath, posix } from '../helpers.js'

/** analyses the `handle` handler of the given controller, inside a fixture */
async function analyze(pattern: string, controller = 'expire_invite_controller.ts') {
  const root = fixturePath('patterns', pattern)
  const app = await discoverApp(root)
  const { stores } = await collectDataStores(app)

  const handler: HandlerRef = {
    file: path.join(root, 'app/collect/controllers', controller),
    member: 'handle',
  }

  return analyzeHandler(app, stores, handler)
}

/**
 * These patterns are THE SAME transaction written in different ways: read an
 * invite and expire it. Every one must reach the data store and detect the
 * write — otherwise the transaction becomes an EO instead of an EI, and the
 * EI vs EO decision moves a large share of the count.
 */
test.group('graph: reaches the data in every code pattern', () => {
  const RESOLVED = [
    'fat_controller',
    'action_object',
    'action_variable',
    'static_service',
    'module_function',
    'job_dispatch',
    'typed_input',
    'property_service',
    'default_injection',
    'same_class_method',
  ]

  for (const pattern of RESOLVED) {
    test(`"${pattern}" reaches the data and detects the write`, async ({ assert }) => {
      const behavior = await analyze(pattern)

      assert.include(behavior.touches, 'Invite', `${pattern} did not reach the store`)
      assert.isTrue(behavior.writes, `${pattern} did not detect the write`)
    })
  }

  /**
   * Injection without the container: the dependency arrives as a default value
   * and carries no type annotation at all, so reading `getTypeNode()` saw
   * nothing. The cost was not a gap in coverage but a wrong classification —
   * the write inside the service stayed invisible and the transaction counted
   * as an EO instead of an EI.
   */
  test('a dependency injected by default value is followed', async ({ assert }) => {
    const behavior = await analyze('default_injection')

    assert.isTrue(behavior.writes, 'the write lives inside the service')
    assert.include(behavior.touches, 'Invite')
    assert.isEmpty(behavior.unresolved)

    const service = behavior.trace.find((step) => posix(step.file).includes('services/'))
    assert.exists(service)
    assert.equal(service!.by, 'property-service')
  })

  test('an annotated dependency and a default-value one agree', async ({ assert }) => {
    const annotated = await analyze('property_service')
    const byDefault = await analyze('default_injection')

    assert.equal(byDefault.writes, annotated.writes)
    assert.deepEqual(byDefault.touches, annotated.touches)
  })

  /**
   * Resolving this does NOT require the TypeScript type checker: AdonisJS
   * `@inject()` only works with an explicit type annotation, so the type is
   * always in the AST as an imported identifier.
   *
   * It matters a great deal — in applications that use DI, `this.someService
   * .method()` is the only path from the route to the write.
   */
  test('an injected dependency resolves from the annotation, no type checker', async ({
    assert,
  }) => {
    const behavior = await analyze('property_service')

    assert.isTrue(behavior.writes)
    assert.isEmpty(behavior.unresolved, 'no unresolved call should be left')

    const service = behavior.trace.find((step) => posix(step.file).includes('services/'))
    assert.exists(service, 'did not walk into the injected service')
    assert.equal(service!.by, 'property-service')
  })
})

/**
 * A dominant shape, and the one that most often hides a write: the action takes
 * `input: ExpireInviteInput` — a NAMED interface — and writes through
 * `input.invite.save()`.
 *
 * The receiver is not an identifier, it is a property path; and the model
 * arrives through `import type`, never used as a value. Without resolving that,
 * the graph reaches the action and does not see the write.
 */
test.group('graph: store reached through a parameter type', () => {
  test('a write in `input.invite.save()` is detected', async ({ assert }) => {
    const behavior = await analyze('typed_input')

    assert.isTrue(behavior.writes, 'the write through a property path was not seen')
    assert.include(behavior.touches, 'Invite')
  })

  test('the write is attributed to the right body', async ({ assert }) => {
    const behavior = await analyze('typed_input')
    const action = behavior.trace.find((step) => posix(step.file).includes('actions/'))

    assert.exists(action)
    assert.isTrue(action!.writes, 'the write happens in the action, not the controller')
  })
})

/**
 * A domain service typically holds many writes. FILE-level detection would mark
 * everyone who imports it as a writer.
 */
test.group('graph: method level, not file level', () => {
  test('calling only the read method does not make you a writer', async ({ assert }) => {
    const behavior = await analyze('method_level', 'list_invites_controller.ts')

    assert.include(behavior.touches, 'Invite', 'it should reach the data to read it')
    assert.isFalse(behavior.writes, 'a read method must not flag a write')
  })

  test('calling the write method does make you a writer', async ({ assert }) => {
    const behavior = await analyze('method_level')
    assert.isTrue(behavior.writes)
  })

  test('the same service file serves both cases', async ({ assert }) => {
    const reading = await analyze('method_level', 'list_invites_controller.ts')
    const writing = await analyze('method_level')

    const service = (steps: typeof reading.trace) =>
      steps.find((step) => step.file.includes('invite_service'))

    assert.exists(service(reading.trace), 'the read did not walk into the service')
    assert.exists(service(writing.trace), 'the write did not walk into the service')
    assert.notEqual(service(reading.trace)!.member, service(writing.trace)!.member)
  })
})

test.group('graph: trace and provenance', () => {
  test('the trace starts at the handler and records who resolved each step', async ({ assert }) => {
    const behavior = await analyze('action_object')

    assert.isAbove(behavior.trace.length, 1, 'the trace should have more than one step')
    assert.equal(behavior.trace[0].depth, 0)
    assert.include(posix(behavior.trace[0].file), 'expire_invite_controller')

    const action = behavior.trace.find((step) => posix(step.file).includes('actions/'))
    assert.exists(action, 'did not walk into the action')
    assert.equal(action!.by, 'action-object', 'the trace must say WHO resolved it')
    assert.isTrue(action!.writes, 'the write happens in the action')
  })

  /**
   * counting-decisions §5: modification is measured by a checksum of the
   * implementation scope. Running Prettier must not turn into an invoice, so
   * the hash is over the normalised AST — no whitespace, no comments.
   */
  test('the scope hash ignores formatting and comments', async ({ assert }) => {
    const compact = await analyze('method_level', 'expire_invite_controller.ts')
    const verbose = await analyze('method_level', 'expire_invite_verbose_controller.ts')

    const handlerHash = (behavior: typeof compact) =>
      behavior.scope.find((entry) => posix(entry.file).includes('controllers/'))!.bodyHash

    assert.equal(
      handlerHash(verbose),
      handlerHash(compact),
      'logically equal bodies must hash the same — otherwise running Prettier bills'
    )
  })

  test('a different body changes the hash', async ({ assert }) => {
    const expire = await analyze('method_level', 'expire_invite_controller.ts')
    const list = await analyze('method_level', 'list_invites_controller.ts')

    const handlerHash = (behavior: typeof expire) =>
      behavior.scope.find((entry) => posix(entry.file).includes('controllers/'))!.bodyHash

    assert.notEqual(handlerHash(expire), handlerHash(list))
  })

  test('the hash is stable hexadecimal', async ({ assert }) => {
    const behavior = await analyze('action_object')

    assert.isNotEmpty(behavior.scope)
    for (const entry of behavior.scope) {
      assert.match(entry.bodyHash, /^[\da-f]{8,}$/)
    }
  })

  test('scope and trace cover the same bodies', async ({ assert }) => {
    const behavior = await analyze('action_object')
    assert.lengthOf(behavior.scope, behavior.trace.length)
  })
})

test.group('graph: same-class method and package boundary', () => {
  /**
   * `this.privateMethod()` is a dominant shape among routes that otherwise
   * reach no data at all. `property-service` does not cover it: that one
   * requires `this.prop.method()`, with two levels.
   */
  test('a write in a private method of the same class is reached', async ({ assert }) => {
    const behavior = await analyze('same_class_method')

    assert.isTrue(behavior.writes)
    assert.include(behavior.touches, 'Invite')

    const privateStep = behavior.trace.find((step) => step.member === 'persistExpiration')
    assert.exists(privateStep, 'did not walk into the private method')
    assert.equal(privateStep!.by, 'same-class-method')
  })

  /**
   * `this.audit()` is a property holding a function, not a method of the class.
   *
   * Without the guard, `same-class-method` would claim it, `findBody` would
   * fail, and the report would say "inherited from a package class" — a lie.
   * The wrong reason sends the reader to the wrong place, and the report exists
   * to be actionable.
   */
  test('a function-valued property is not claimed as a class method', async ({ assert }) => {
    const behavior = await analyze('same_class_method')
    const unresolved = behavior.unresolved.find((u) => u.expression.includes('audit'))

    assert.exists(unresolved, 'the call should appear as unresolved')
    assert.notMatch(
      unresolved!.reason,
      /package class/i,
      'wrong reason: this is not package inheritance, it is a function-valued property'
    )
  })

  /**
   * `InviteMailer.sendLater()` resolves to the application file, but the method
   * is inherited from a PACKAGE class — it is not there, and unlike a
   * transformer there is no application-side body it calls back into.
   *
   * Dropping it silently would be the worst possible defect: the resolver
   * produces the reference, `findBody` fails and nobody knows. It has to become
   * an unresolved entry with the right reason.
   */
  test('a method inherited from a package is reported, not silenced', async ({ assert }) => {
    const behavior = await analyze('same_class_method')
    const unresolved = behavior.unresolved.find((u) => u.expression.includes('sendLater'))

    assert.exists(unresolved, 'a body that was not found got dropped in silence')
    assert.match(unresolved!.reason, /body not found/i)
  })
})

test.group('graph: cost', () => {
  /**
   * Adding a file to the project AFTER querying the checker invalidates the
   * TypeScript program, and the next query rebuilds it — a cost paid once per
   * route, uniformly, and the difference between minutes and seconds on a large
   * application.
   *
   * This test does not measure time (that would be flaky in CI). It measures
   * the cause: after the first analysis, no new file enters the project.
   */
  test('no file enters the project after the first analysis', async ({ assert }) => {
    const root = fixturePath('patterns', 'action_object')
    const app = await discoverApp(root)
    const { stores } = await collectDataStores(app)

    const analyzer = createAnalyzer(app, stores)
    const handler = {
      file: path.join(root, 'app/collect/controllers/expire_invite_controller.ts'),
      member: 'handle',
    }

    const before = analyzer.fileCount()
    assert.isAbove(before, 0, 'the project should be born loaded')

    analyzer.analyze(handler)

    assert.equal(
      analyzer.fileCount(),
      before,
      'a file entered the project during the analysis: that invalidates the ' +
        'TypeScript program and the next query to the checker rebuilds it'
    )
  })
})

test.group('graph: boundary', () => {
  /**
   * counting-decisions §1: a route that reaches no data at all is not a
   * transactional function. It falls out of the general rule, with no special
   * case.
   */
  test('a handler that touches no data reaches no store', async ({ assert }) => {
    const root = fixturePath('patterns', 'fat_controller')
    const app = await discoverApp(root)
    const { stores } = await collectDataStores(app)

    const behavior = analyzeHandler(app, stores, {
      file: path.join(root, 'app/collect/models/invite.ts'),
      member: 'nonexistent',
    })

    assert.isEmpty(behavior.touches)
    assert.isFalse(behavior.writes)
  })

  test('the maximum depth is respected', async ({ assert }) => {
    const root = fixturePath('patterns', 'action_object')
    const app = await discoverApp(root)
    const { stores } = await collectDataStores(app)

    const shallow = analyzeHandler(
      app,
      stores,
      {
        file: path.join(root, 'app/collect/controllers/expire_invite_controller.ts'),
        member: 'handle',
      },
      { maxDepth: 0 }
    )

    assert.lengthOf(shallow.trace, 1, 'at depth 0, only the handler itself')
    assert.isFalse(shallow.writes, 'the write is one level below')
  })
})
