/**
 * A real application writes `import { defineConfig } from
 * '@filipebraida/adonis-function-points'`. A fixture cannot resolve the package
 * it lives inside, so it exports the plain object — which is the same thing the
 * loader receives, since it runs `defineConfig()` over whatever it loads.
 */
export default {
  boundary: { infrastructure: ['Book'] },
  maxDepth: 7,
}
