/**
 * The control: an application class that happens to own a `transform` method
 * and extends nothing from a package.
 *
 * Claiming it would mean the resolver matched on the method name, which is the
 * mistake this package keeps having to avoid — `transform` is as plausible on
 * an application helper as on a framework base.
 */
export default class LocalFormatter {
  transform(value: string) {
    return value.trim()
  }
}
