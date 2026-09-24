/**
 * Inventory layer: extracts raw facts from the application.
 *
 * ARCHITECTURAL RULE: nothing here imports from `src/albrecht/**`. The
 * inventory does not know what an ILF is. That separation is what would allow
 * extracting this layer into its own package if the structural metrics grow.
 *
 * SOURCE PRECEDENCE, most to least reliable:
 *   1. generated artefacts — route registry, generated data schema
 *   2. runtime            — router.toJSON(), Lucid metadata
 *   3. AST                — call graph, write detection
 *   4. folder convention  — report grouping only, never for finding things
 */
export * from './resolvers/index.js'
export type { AppContext } from './app_context.js'
