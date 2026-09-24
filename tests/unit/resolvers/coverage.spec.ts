import { test } from '@japa/runner'
import fs from 'node:fs'

import { resolveCall } from '../../../src/inventory/resolvers/index.js'
import { fixturePath, loadFixture } from '../../helpers.js'

/**
 * Every fixture under `patterns/` is THE SAME transaction written in a
 * different way. Each one must be reachable by some built-in strategy.
 *
 * This test is the package's gap list in executable form: when someone adds a
 * fixture without the matching resolver, it fails.
 */

/**
 * Patterns whose resolver does not exist yet — see docs/design/resolvers.md.
 *
 * Empty today. `property_service` left this list once it became clear that
 * `@inject()` requires the type annotation, so no type checker is needed.
 */
const KNOWN_GAPS = new Set<string>()

/** which strategy MUST claim each pattern — the ordering is part of the contract */
const EXPECTED_STRATEGY: Record<string, string> = {
  action_object: 'action-object',
  action_variable: 'action-object',
  job_dispatch: 'job-dispatch',
  static_service: 'static-service',
  property_service: 'property-service',
  module_function: 'module-function',
}

/**
 * Patterns whose characteristic call is NOT in the controller.
 *
 * `fat_controller` writes in the handler itself: that is a case for the
 * persistence detector, not for a resolver. `same_class_method` and
 * `typed_input` have their characteristic call inside the service or the
 * action — in the controller they use another shape, and asserting otherwise
 * here would be a lying test.
 */
const NO_RESOLVER_BY_DESIGN = new Set(['fat_controller'])

const patterns = fs
  .readdirSync(fixturePath('patterns'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

test.group('pattern coverage', () => {
  test('there is at least one fixture per documented pattern', async ({ assert }) => {
    assert.isAbove(patterns.length, 4)
  })

  for (const pattern of patterns) {
    const expected = !KNOWN_GAPS.has(pattern) && !NO_RESOLVER_BY_DESIGN.has(pattern)

    test(`pattern "${pattern}" ${expected ? 'is resolved' : 'is a known gap'}`, async ({
      assert,
    }) => {
      const fixture = await loadFixture(pattern)
      const controller = fixture.controller()
      const ctx = fixture.contextFor(controller)

      const resolved = fixture
        .callsIn(controller, 'handle')
        .some((call) => resolveCall(call, ctx) !== null)

      assert.equal(
        resolved,
        expected,
        expected
          ? `no strategy followed "${pattern}"`
          : `"${pattern}" is now resolved — remove it from KNOWN_GAPS`
      )
    })
  }

  /**
   * Regression for the trap this test uncovered: `Job.dispatch(p)` and
   * `Service.create(p)` are syntactically identical, and the generic strategy
   * swallowed the job. If anyone reorders the strategies, this fails.
   */
  for (const [pattern, expected] of Object.entries(EXPECTED_STRATEGY)) {
    test(`"${pattern}" is claimed by "${expected}"`, async ({ assert }) => {
      const fixture = await loadFixture(pattern)
      const controller = fixture.controller()
      const ctx = fixture.contextFor(controller)

      const claims = fixture
        .callsIn(controller, 'handle')
        .map((call) => resolveCall(call, ctx))
        .filter((r): r is NonNullable<typeof r> => r !== null)

      assert.isNotEmpty(claims)
      for (const r of claims) assert.equal(r.by, expected)
    })
  }
})
