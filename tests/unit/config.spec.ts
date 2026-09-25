import { test } from '@japa/runner'
import { Node, SyntaxKind } from 'ts-morph'

import { analyze } from '../../src/pipeline.js'
import { defineConfig } from '../../src/define_config.js'
import type { CallResolver } from '../../src/inventory/resolvers/types.js'
import { appFixturePath } from '../helpers.js'

/**
 * Configuration the code does not honour is worse than no configuration at
 * all: whoever sets it believes something changed when nothing did.
 *
 * Every option exposed by `defineConfig` has a test here proving it has an
 * effect. If an option cannot be honoured, it leaves the type — it does not
 * stay as a promise.
 */

test.group('config: application boundary', () => {
  /**
   * The boundary is a business decision, not a heuristic — which is why it is
   * configuration and not a built-in rule.
   */
  test('`infrastructure` removes the store from the count', async ({ assert }) => {
    const withoutConfig = await analyze(appFixturePath('minimal_flat'))
    assert.exists(withoutConfig.count.functions.find((fn) => fn.name === 'Book'))

    const withConfig = await analyze(appFixturePath('minimal_flat'), {
      boundary: { infrastructure: ['Book'] },
    })

    assert.notExists(withConfig.count.functions.find((fn) => fn.name === 'Book'))
    assert.isTrue(
      withConfig.count.confidence.warnings.some((w) => w.includes('Book')),
      'an exclusion by configuration must appear in the report too'
    )
  })

  test('`externallyMaintained` turns an ILF into an EIF', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'), {
      boundary: { externallyMaintained: ['Book'] },
    })

    assert.equal(count.functions.find((fn) => fn.name === 'Book')!.type, 'EIF')
  })

  /**
   * The AFP naming filter (§6.5.2.1.3) is a heuristic over names: it excludes
   * anything containing `session`, `template`, `error`, `types`. In most
   * applications those hold infrastructure; when they hold the business — a chat
   * session the user manages, a document template they maintain — the exclusion
   * is wrong, and no heuristic can tell the difference.
   *
   * Until this existed there was no way to disagree with the filter, and on a
   * production application it was silently removing 30 function points.
   */
  test('`business` overrules the AFP naming filter', async ({ assert }) => {
    const filtered = await analyze(appFixturePath('edges_boundary'))
    assert.notExists(filtered.count.functions.find((fn) => fn.name === 'UserSession'))

    const kept = await analyze(appFixturePath('edges_boundary'), {
      boundary: { business: ['UserSession'] },
    })

    assert.exists(
      kept.count.functions.find((fn) => fn.name === 'UserSession'),
      'a declaration has to win over a pattern match on the name'
    )
  })

  test('and the report says the filter was overruled', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('edges_boundary'), {
      boundary: { business: ['UserSession'] },
    })

    assert.isTrue(
      count.confidence.warnings.some(
        (w) => /kept by boundary configuration: UserSession/.test(w) && /naming filter/.test(w)
      ),
      'bringing a store back has to be as visible as excluding one'
    )
  })

  test('`business` naming nothing filtered changes nothing', async ({ assert }) => {
    const plain = await analyze(appFixturePath('minimal_flat'))
    const declared = await analyze(appFixturePath('minimal_flat'), {
      boundary: { business: ['Nonexistent'] },
    })

    assert.equal(declared.count.totals.unadjusted, plain.count.totals.unadjusted)
  })

  test('`ignoreEntryPoints` removes the route from the count', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('minimal_flat'), {
      boundary: { ignoreEntryPoints: ['books.index'] },
    })

    assert.notExists(count.functions.find((fn) => fn.name === 'GET /books'))
    assert.exists(count.functions.find((fn) => fn.name === 'POST /books'))
  })

  test('the name may be the identity or the route name', async ({ assert }) => {
    const byIdentity = await analyze(appFixturePath('minimal_flat'), {
      boundary: { ignoreEntryPoints: ['GET /books'] },
    })

    assert.notExists(byIdentity.count.functions.find((fn) => fn.name === 'GET /books'))
  })
})

test.group('config: complexity tables', () => {
  /**
   * The tables are configurable because a single DET of difference — the
   * message no static analysis can see — crosses a band and changes the value.
   * Calibrating the bands is more honest than pretending the bias is not there.
   */
  test('`weights` changes the value of the functions', async ({ assert }) => {
    const standard = await analyze(appFixturePath('minimal_flat'))
    const altered = await analyze(appFixturePath('minimal_flat'), {
      weights: { ILF: { low: 70, average: 100, high: 150 } },
    })

    assert.isAbove(altered.count.totals.unadjusted, standard.count.totals.unadjusted)
  })

  test('`complexityTables` changes the bands', async ({ assert }) => {
    const standard = await analyze(appFixturePath('minimal_flat'))
    const tight = await analyze(appFixturePath('minimal_flat'), {
      // narrow DET band: 5 columns now fall into the higher band
      complexityTables: { ILF: { refBands: [1, 5], detBands: [1, 2] } },
    })

    assert.equal(standard.count.functions.find((fn) => fn.name === 'Book')!.complexity, 'low')

    /**
     * With RET = 1 the IFPUG grid never reaches "high": the first RET band tops
     * out at average. Raising the complexity requires a higher RET, not just
     * more DETs.
     */
    assert.equal(tight.count.functions.find((fn) => fn.name === 'Book')!.complexity, 'average')
    assert.isAbove(tight.count.totals.unadjusted, standard.count.totals.unadjusted)
  })

  test('`messageDet` adds the DET IFPUG counts and AFP does not', async ({ assert }) => {
    const afp = await analyze(appFixturePath('minimal_flat'))
    const ifpug = await analyze(appFixturePath('minimal_flat'), { messageDet: 1 })

    const before = afp.count.functions.find((fn) => fn.name === 'POST /books')!
    const after = ifpug.count.functions.find((fn) => fn.name === 'POST /books')!

    assert.equal(after.det, before.det + 1)
  })
})

test.group('config: custom resolver', () => {
  /**
   * The architecture's central claim: AdonisJS imposes no organisation pattern,
   * so tracing is extensible. If the resolver registered in the configuration
   * does not enter the graph, the claim is false.
   *
   * This resolver recognises a pattern no built-in covers:
   * `repo<Model>().gravar()`.
   */
  const fictitiousRepository: CallResolver = {
    name: 'repo-fictitious',
    order: 1,
    resolve(call, ctx) {
      const expression = call.getExpression()
      if (!Node.isPropertyAccessExpression(expression)) return []
      if (expression.getName() !== 'gravar') return []

      const receiver = expression.getExpression()
      if (!Node.isCallExpression(receiver)) return []
      if (receiver.getExpression().getText() !== 'repo') return []

      const target = receiver.getArguments()[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue()
      const file = target ? ctx.resolveSpecifier(target) : null
      return file ? [{ file, member: 'gravar' }] : []
    },
  }

  test('a resolver from the configuration enters the graph', async ({ assert }) => {
    const withoutResolver = await analyze(appFixturePath('custom_resolver'))
    const withResolver = await analyze(appFixturePath('custom_resolver'), {
      resolvers: { call: [fictitiousRepository] },
    })

    const route = 'POST /itens'
    assert.notExists(
      withoutResolver.count.functions.find((fn) => fn.name === route),
      'without the resolver the transaction reaches no data and does not count'
    )
    assert.exists(
      withResolver.count.functions.find((fn) => fn.name === route),
      'with the resolver the transaction reaches the data'
    )
    assert.equal(withResolver.count.functions.find((fn) => fn.name === route)!.type, 'EI')
  })

  test('a resolver from the configuration runs before the built-ins', async ({ assert }) => {
    const { count } = await analyze(appFixturePath('custom_resolver'), {
      resolvers: { call: [fictitiousRepository] },
    })

    const trace = count.functions.find((fn) => fn.name === 'POST /itens')!.rationale.trace!
    assert.isTrue(
      trace.some((step) => step.by === 'repo-fictitious'),
      'the trace must say it was the user strategy'
    )
  })
})

test.group('config: defineConfig', () => {
  test('fills in the defaults without erasing what was passed', async ({ assert }) => {
    const config = defineConfig({ boundary: { infrastructure: ['audits'] } })

    assert.deepEqual(config.boundary.infrastructure, ['audits'])
    assert.equal(config.retStrategy, 'constant')
    assert.equal(config.messageDet, 0, 'the default follows AFP, not the IFPUG manual')
  })

  test('does not expose an option the code does not honour', async ({ assert }) => {
    const config = defineConfig({}) as Record<string, unknown>

    // removed for having no effect: see docs/design/architecture.md
    assert.notProperty(config, 'collapseInquiriesIntoOutputs')
    assert.notProperty(config, 'calibration')
  })
})
