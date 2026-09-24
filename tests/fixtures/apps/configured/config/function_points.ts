/**
 * Proves the configuration file reaches the count through the command layer.
 *
 * `Book` is the only store the application writes; excluding it as
 * infrastructure has to change both the function list and the total. If this
 * file is ignored — as it was before the loader existed — the count comes back
 * identical to `minimal_flat` and the test fails.
 */
export default {
  boundary: { infrastructure: ['Book'] },
}
